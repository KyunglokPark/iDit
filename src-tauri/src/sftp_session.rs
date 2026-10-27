// SFTP 세션 — SSH 접속(비밀번호 인증만) + SFTP 서브시스템 열기 + 커맨드.
// iDrop의 connect.rs/pool.rs에서 필요한 부분만 가져와 단순화했다: 개인키·에이전트
// 인증은 지원하지 않는다(연결 모달이 호스트/포트/사용자/비밀번호만 받음).
// 파일 읽기/쓰기는 sftp.rs의 download_file/upload_file(로컬 경로 대상)을 그대로
// 쓰기 위해 임시 파일을 경유한다 — 텍스트 편집기 용도라 파일이 작아 부담이 없다.

use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use std::time::Duration;

use russh::client::{self, AuthResult, KeyboardInteractiveAuthResponse};
use russh::keys::PublicKeyOrCertificate;
use tauri::{AppHandle, State};

use crate::hostkey;
use crate::sftp::{NameCodec, Sftp};

/// FTP의 FtpEntry와 같은 모양 — 프런트는 두 프로토콜을 같은 타입으로 다룬다.
#[derive(serde::Serialize)]
pub struct RemoteEntry {
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
    pub mtime: i64,
    pub modified: String,
}

#[derive(Clone)]
struct Handler {
    app: AppHandle,
    host: String,
    port: u16,
}

impl client::Handler for Handler {
    type Error = russh::Error;

    async fn check_server_key(&mut self, key: &PublicKeyOrCertificate) -> Result<bool, Self::Error> {
        Ok(hostkey::verify(&self.app, &self.host, self.port, key))
    }
}

type SshHandle = client::Handle<Handler>;

pub struct SftpSession {
    #[allow(dead_code)] // SSH 연결을 살려두기 위해 들고만 있는다
    ssh: SshHandle,
    sftp: Arc<Sftp>,
}

#[derive(Default)]
pub struct SftpState(pub tokio::sync::Mutex<Option<SftpSession>>);

fn err(e: impl std::fmt::Display) -> String {
    format!("SFTP 오류: {e}")
}

async fn tcp_connect(host: &str, port: u16) -> Result<tokio::net::TcpStream, String> {
    let mut addrs: Vec<SocketAddr> = tokio::net::lookup_host((host, port))
        .await
        .map_err(|e| format!("{host}: 주소 확인 실패 ({e})"))?
        .collect();
    if addrs.is_empty() {
        return Err(format!("{host}: 주소를 찾을 수 없습니다"));
    }
    addrs.sort_by_key(|a| match a {
        SocketAddr::V4(_) => 0,
        SocketAddr::V6(_) => 1,
    });
    let mut last = String::new();
    for a in addrs {
        match tokio::time::timeout(Duration::from_secs(5), tokio::net::TcpStream::connect(a)).await {
            Ok(Ok(s)) => {
                let _ = s.set_nodelay(true);
                return Ok(s);
            }
            Ok(Err(e)) => last = format!("{a}: {e}"),
            Err(_) => last = format!("{a}: 응답 없음"),
        }
    }
    Err(last)
}

async fn try_password(handle: &mut SshHandle, user: &str, pass: &str) -> Result<bool, russh::Error> {
    if let AuthResult::Success = handle.authenticate_password(user, pass).await? {
        return Ok(true);
    }
    let mut resp = handle.authenticate_keyboard_interactive_start(user, None::<String>).await?;
    for _ in 0..10 {
        match resp {
            KeyboardInteractiveAuthResponse::Success => return Ok(true),
            KeyboardInteractiveAuthResponse::Failure { .. } => return Ok(false),
            KeyboardInteractiveAuthResponse::InfoRequest { prompts, .. } => {
                let answers: Vec<String> = prompts.iter().map(|_| pass.to_string()).collect();
                resp = handle.authenticate_keyboard_interactive_respond(answers).await?;
            }
        }
    }
    Ok(false)
}

async fn connect_and_auth(app: &AppHandle, host: &str, port: u16, user: &str, pass: &str) -> Result<SshHandle, String> {
    let socket = tcp_connect(host, port).await?;
    let config = Arc::new(client::Config {
        keepalive_interval: Some(Duration::from_secs(30)),
        ..Default::default()
    });
    let handler = Handler { app: app.clone(), host: host.to_string(), port };
    let mut handle = tokio::time::timeout(Duration::from_secs(15), client::connect_stream(config, socket, handler))
        .await
        .map_err(|_| "SSH 핸드셰이크 시간 초과".to_string())?
        .map_err(|e| match e {
            russh::Error::UnknownKey => "호스트 키를 신뢰할 수 없어 접속을 중단했습니다".to_string(),
            e => format!("연결 실패: {e}"),
        })?;

    if try_password(&mut handle, user, pass).await.map_err(|e| format!("인증 오류: {e}"))? {
        Ok(handle)
    } else {
        Err("인증 실패: 사용자명/비밀번호를 확인하세요".to_string())
    }
}

async fn open_sftp(handle: &SshHandle) -> Result<Arc<Sftp>, String> {
    let ch = handle.channel_open_session().await.map_err(|e| format!("SFTP 채널 열기 실패: {e}"))?;
    ch.request_subsystem(true, "sftp").await.map_err(|e| format!("SFTP 시작 실패: {e}"))?;
    tokio::time::timeout(Duration::from_secs(15), Sftp::start(ch.into_stream(), Arc::new(NameCodec::default())))
        .await
        .map_err(|_| "SFTP 응답 없음 (서버에서 SFTP가 꺼져 있을 수 있습니다)".to_string())?
}

static TMP_SEQ: AtomicU32 = AtomicU32::new(1);

fn temp_path() -> PathBuf {
    let n = TMP_SEQ.fetch_add(1, Ordering::Relaxed);
    std::env::temp_dir().join(format!("idit-sftp-{}-{n}.tmp", std::process::id()))
}

#[tauri::command]
pub async fn sftp_connect(
    app: AppHandle,
    state: State<'_, SftpState>,
    host: String,
    port: u16,
    user: String,
    pass: String,
) -> Result<(), String> {
    let ssh = connect_and_auth(&app, &host, port, &user, &pass).await?;
    let sftp = open_sftp(&ssh).await?;
    *state.0.lock().await = Some(SftpSession { ssh, sftp });
    Ok(())
}

#[tauri::command]
pub async fn sftp_disconnect(state: State<'_, SftpState>) -> Result<(), String> {
    *state.0.lock().await = None;
    Ok(())
}

#[tauri::command]
pub async fn sftp_pwd(state: State<'_, SftpState>) -> Result<String, String> {
    let guard = state.0.lock().await;
    let session = guard.as_ref().ok_or_else(|| err("SFTP에 연결되어 있지 않습니다"))?;
    session.sftp.realpath(".").await
}

#[tauri::command]
pub async fn sftp_list(state: State<'_, SftpState>, path: String) -> Result<Vec<RemoteEntry>, String> {
    let guard = state.0.lock().await;
    let session = guard.as_ref().ok_or_else(|| err("SFTP에 연결되어 있지 않습니다"))?;
    let entries = session.sftp.list(&path).await?;
    Ok(entries
        .into_iter()
        .map(|e| RemoteEntry {
            name: e.name,
            is_dir: e.is_dir,
            size: if e.is_dir { 0 } else { e.size },
            mtime: e.mtime as i64,
            modified: String::new(),
        })
        .collect())
}

#[tauri::command]
pub async fn sftp_read_file(state: State<'_, SftpState>, path: String) -> Result<String, String> {
    let guard = state.0.lock().await;
    let session = guard.as_ref().ok_or_else(|| err("SFTP에 연결되어 있지 않습니다"))?;
    let tmp = temp_path();
    let cancel = std::sync::atomic::AtomicBool::new(false);
    let res = session.sftp.download_file(&path, &tmp, 0, &cancel, &mut |_| {}).await;
    let bytes = match res {
        Ok(()) => tokio::fs::read(&tmp).await.map_err(|e| e.to_string())?,
        Err(e) => {
            let _ = tokio::fs::remove_file(&tmp).await;
            return Err(e);
        }
    };
    let _ = tokio::fs::remove_file(&tmp).await;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

#[tauri::command]
pub async fn sftp_write_file(state: State<'_, SftpState>, path: String, content: String) -> Result<(), String> {
    let guard = state.0.lock().await;
    let session = guard.as_ref().ok_or_else(|| err("SFTP에 연결되어 있지 않습니다"))?;
    let tmp = temp_path();
    tokio::fs::write(&tmp, content.as_bytes()).await.map_err(|e| e.to_string())?;
    let cancel = std::sync::atomic::AtomicBool::new(false);
    let res = session.sftp.upload_file(&tmp, &path, 0, &cancel, &mut |_| {}).await;
    let _ = tokio::fs::remove_file(&tmp).await;
    res
}
