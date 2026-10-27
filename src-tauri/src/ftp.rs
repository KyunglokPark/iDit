// 최소 FTP 클라이언트 — 연결 → 디렉터리 탐색 → 파일 열기/저장만 지원한다 (RFC 959, PASV).
// 한 번에 세션 하나만 유지한다 (에디터는 파일 하나를 편집하는 앱이라 다중 연결이 필요 없음).

use serde::Serialize;
use tauri::State;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpStream;

#[derive(Serialize, Clone)]
pub struct FtpEntry {
    pub name: String,
    pub is_dir: bool,
    /// 파일 크기(바이트). 폴더는 0.
    pub size: u64,
    /// 수정 시각(유닉스 초). 모르면 0 — 그때는 `modified` 문자열을 쓴다.
    pub mtime: i64,
    /// 서버가 준 날짜 문자열(FTP LIST의 "월 일 시각"). mtime을 모를 때 표시용.
    pub modified: String,
}

pub struct FtpSession {
    ctrl: BufReader<TcpStream>,
}

#[derive(Default)]
pub struct FtpState(pub tokio::sync::Mutex<Option<FtpSession>>);

fn err(e: impl std::fmt::Display) -> String {
    format!("FTP 오류: {e}")
}

impl FtpSession {
    async fn read_reply(&mut self) -> Result<(u16, String), String> {
        let mut first = String::new();
        self.ctrl.read_line(&mut first).await.map_err(err)?;
        if first.len() < 4 {
            return Err(err("서버 응답 없음"));
        }
        let code: u16 = first[..3].parse().map_err(|_| err("잘못된 응답 코드"))?;
        let mut text = first.clone();
        if first.as_bytes().get(3) == Some(&b'-') {
            let end = format!("{code} ");
            loop {
                let mut line = String::new();
                if self.ctrl.read_line(&mut line).await.map_err(err)? == 0 {
                    break;
                }
                text.push_str(&line);
                if line.starts_with(&end) {
                    break;
                }
            }
        }
        Ok((code, text))
    }

    async fn cmd(&mut self, line: &str) -> Result<(u16, String), String> {
        self.ctrl.get_mut().write_all(line.as_bytes()).await.map_err(err)?;
        self.ctrl.get_mut().write_all(b"\r\n").await.map_err(err)?;
        self.ctrl.get_mut().flush().await.map_err(err)?;
        self.read_reply().await
    }

    async fn expect(&mut self, line: &str, ok: &[u16]) -> Result<String, String> {
        let (code, text) = self.cmd(line).await?;
        if ok.contains(&code) {
            Ok(text)
        } else {
            Err(err(format!("{line} -> {text}")))
        }
    }

    async fn pasv(&mut self) -> Result<TcpStream, String> {
        let (code, text) = self.cmd("PASV").await?;
        if code != 227 {
            return Err(err(format!("PASV 실패: {text}")));
        }
        let start = text.find('(').ok_or_else(|| err("PASV 응답 파싱 실패"))?;
        let end = text.find(')').ok_or_else(|| err("PASV 응답 파싱 실패"))?;
        let nums: Vec<u32> = text[start + 1..end]
            .split(',')
            .map(|s| s.trim().parse().unwrap_or(0))
            .collect();
        if nums.len() != 6 {
            return Err(err("PASV 응답 파싱 실패"));
        }
        let ip = format!("{}.{}.{}.{}", nums[0], nums[1], nums[2], nums[3]);
        let port = (nums[4] * 256 + nums[5]) as u16;
        TcpStream::connect((ip.as_str(), port)).await.map_err(err)
    }

    pub async fn connect(host: &str, port: u16, user: &str, pass: &str) -> Result<Self, String> {
        let stream = TcpStream::connect((host, port)).await.map_err(err)?;
        let mut session = FtpSession {
            ctrl: BufReader::new(stream),
        };
        let (code, text) = session.read_reply().await?;
        if code != 220 {
            return Err(err(format!("서버 환영 메시지 없음: {text}")));
        }
        let (code, text) = session.cmd(&format!("USER {user}")).await?;
        if code == 331 {
            session.expect(&format!("PASS {pass}"), &[230]).await?;
        } else if code != 230 {
            return Err(err(format!("로그인 실패: {text}")));
        }
        session.expect("TYPE I", &[200]).await?;
        Ok(session)
    }

    pub async fn pwd(&mut self) -> Result<String, String> {
        let (code, text) = self.cmd("PWD").await?;
        if code != 257 {
            return Err(err(format!("PWD 실패: {text}")));
        }
        let start = text.find('"').ok_or_else(|| err("PWD 파싱 실패"))?;
        let rel_end = text[start + 1..].find('"').ok_or_else(|| err("PWD 파싱 실패"))?;
        Ok(text[start + 1..start + 1 + rel_end].to_string())
    }

    pub async fn list(&mut self, path: &str) -> Result<Vec<FtpEntry>, String> {
        let mut data = self.pasv().await?;
        let cmd = if path.is_empty() {
            "LIST".to_string()
        } else {
            format!("LIST {path}")
        };
        let (code, text) = self.cmd(&cmd).await?;
        if code != 150 && code != 125 {
            return Err(err(format!("LIST 시작 실패: {text}")));
        }
        let mut buf = Vec::new();
        data.read_to_end(&mut buf).await.map_err(err)?;
        let (code, text) = self.read_reply().await?;
        if code != 226 && code != 250 {
            return Err(err(format!("LIST 종료 실패: {text}")));
        }
        let listing = String::from_utf8_lossy(&buf);
        let mut entries: Vec<FtpEntry> = listing.lines().filter_map(parse_list_line).collect();
        entries.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.name.cmp(&b.name)));
        Ok(entries)
    }

    pub async fn retr(&mut self, path: &str) -> Result<Vec<u8>, String> {
        let mut data = self.pasv().await?;
        let (code, text) = self.cmd(&format!("RETR {path}")).await?;
        if code != 150 && code != 125 {
            return Err(err(format!("RETR 시작 실패: {text}")));
        }
        let mut buf = Vec::new();
        data.read_to_end(&mut buf).await.map_err(err)?;
        let (code, text) = self.read_reply().await?;
        if code != 226 && code != 250 {
            return Err(err(format!("RETR 종료 실패: {text}")));
        }
        Ok(buf)
    }

    pub async fn stor(&mut self, path: &str, content: &[u8]) -> Result<(), String> {
        let mut data = self.pasv().await?;
        let (code, text) = self.cmd(&format!("STOR {path}")).await?;
        if code != 150 && code != 125 {
            return Err(err(format!("STOR 시작 실패: {text}")));
        }
        data.write_all(content).await.map_err(err)?;
        data.shutdown().await.map_err(err)?;
        let (code, text) = self.read_reply().await?;
        if code != 226 && code != 250 {
            return Err(err(format!("STOR 종료 실패: {text}")));
        }
        Ok(())
    }
}

/// Unix 스타일 `LIST` 한 줄을 해석한다 (권한 링크수 소유자 그룹 크기 월 일 시간/연도 이름).
/// 필드: [0]권한 [1]링크수 [2]소유자 [3]그룹 [4]크기 [5]월 [6]일 [7]시각/연도 [8..]이름
fn parse_list_line(line: &str) -> Option<FtpEntry> {
    let trimmed = line.trim_end();
    if trimmed.is_empty() {
        return None;
    }
    let is_dir = trimmed.starts_with('d') || trimmed.starts_with('l');

    // 앞 8개 필드를 집계하면서 크기(4번)·날짜(5~7번)를 모은다.
    let mut size: u64 = 0;
    let mut date_parts: Vec<&str> = Vec::new();
    let mut rest = trimmed;
    for i in 0..8 {
        let field = rest.split_whitespace().next()?;
        if i == 4 {
            size = field.parse().unwrap_or(0);
        } else if (5..=7).contains(&i) {
            date_parts.push(field);
        }
        let idx = rest.find(char::is_whitespace)?;
        rest = rest[idx..].trim_start();
    }
    if rest.is_empty() {
        return None;
    }
    let name = match rest.find(" -> ") {
        Some(pos) => &rest[..pos],
        None => rest,
    };
    if name == "." || name == ".." {
        return None;
    }
    Some(FtpEntry {
        name: name.to_string(),
        is_dir,
        size: if is_dir { 0 } else { size },
        mtime: 0,
        modified: date_parts.join(" "),
    })
}

#[tauri::command]
pub async fn ftp_connect(
    state: State<'_, FtpState>,
    host: String,
    port: u16,
    user: String,
    pass: String,
) -> Result<(), String> {
    let session = FtpSession::connect(&host, port, &user, &pass).await?;
    *state.0.lock().await = Some(session);
    Ok(())
}

#[tauri::command]
pub async fn ftp_disconnect(state: State<'_, FtpState>) -> Result<(), String> {
    *state.0.lock().await = None;
    Ok(())
}

#[tauri::command]
pub async fn ftp_pwd(state: State<'_, FtpState>) -> Result<String, String> {
    let mut guard = state.0.lock().await;
    let session = guard.as_mut().ok_or_else(|| err("FTP에 연결되어 있지 않습니다"))?;
    session.pwd().await
}

#[tauri::command]
pub async fn ftp_list(state: State<'_, FtpState>, path: String) -> Result<Vec<FtpEntry>, String> {
    let mut guard = state.0.lock().await;
    let session = guard.as_mut().ok_or_else(|| err("FTP에 연결되어 있지 않습니다"))?;
    session.list(&path).await
}

#[tauri::command]
pub async fn ftp_read_file(state: State<'_, FtpState>, path: String) -> Result<String, String> {
    let mut guard = state.0.lock().await;
    let session = guard.as_mut().ok_or_else(|| err("FTP에 연결되어 있지 않습니다"))?;
    let bytes = session.retr(&path).await?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

#[tauri::command]
pub async fn ftp_write_file(
    state: State<'_, FtpState>,
    path: String,
    content: String,
) -> Result<(), String> {
    let mut guard = state.0.lock().await;
    let session = guard.as_mut().ok_or_else(|| err("FTP에 연결되어 있지 않습니다"))?;
    session.stor(&path, content.as_bytes()).await
}
