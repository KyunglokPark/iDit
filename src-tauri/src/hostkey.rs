// 서버 호스트 키 확인 — iDrop의 known_hosts 확인 로직을 그대로 쓰되, 확인창 대신
// 자동 TOFU(Trust On First Use)로 단순화했다: 처음 보는 서버는 자동으로 믿고
// 저장하고, 저장된 키와 다르면(= 서버가 바뀌었거나 중간자 공격 가능성) 접속을 거부한다.
use std::path::PathBuf;

use russh::keys::ssh_key::PublicKey;
use russh::keys::PublicKeyOrCertificate;
use tauri::{AppHandle, Manager};

/// iDit 전용 known_hosts 경로
fn own_path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("known_hosts"))
}

/// 사용자의 OpenSSH known_hosts (읽기 전용 — 이미 다른 SSH 클라이언트로 접속해 본 서버는 묻지 않는다)
fn user_path() -> Option<PathBuf> {
    let home = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME"))?;
    Some(PathBuf::from(home).join(".ssh").join("known_hosts"))
}

#[derive(PartialEq)]
enum Known {
    Match,
    Unknown,
    Changed,
}

fn lookup(path: &std::path::Path, host: &str, port: u16, key: &PublicKey) -> Known {
    match russh::keys::check_known_hosts_path(host, port, key, path) {
        Ok(true) => Known::Match,
        Ok(false) => Known::Unknown,
        Err(russh::keys::Error::KeyChanged { .. }) => Known::Changed,
        Err(_) => Known::Unknown,
    }
}

fn host_field(host: &str, port: u16) -> String {
    if port == 22 {
        host.to_string()
    } else {
        format!("[{host}]:{port}")
    }
}

fn save(path: &std::path::Path, host: &str, port: u16, key: &PublicKey) -> std::io::Result<()> {
    let field = host_field(host, port);
    let old = std::fs::read_to_string(path).unwrap_or_default();
    let mut out = String::new();
    for line in old.lines() {
        let hosts = line.split_whitespace().next().unwrap_or("");
        if !line.starts_with('#') && hosts.split(',').any(|h| h == field) {
            continue; // 바뀐 키의 옛 줄
        }
        out.push_str(line);
        out.push('\n');
    }
    let openssh = key.to_openssh().map_err(|e| std::io::Error::other(e.to_string()))?;
    out.push_str(&format!("{field} {openssh}\n"));
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    std::fs::write(path, out)
}

/// 서버가 보여준 키를 확인한다. true면 접속을 계속한다.
pub fn verify(app: &AppHandle, host: &str, port: u16, key: &PublicKeyOrCertificate) -> bool {
    let key: PublicKey = match key {
        PublicKeyOrCertificate::PublicKey { key, .. } => key.clone(),
        PublicKeyOrCertificate::Certificate(c) => PublicKey::from(c.public_key().clone()),
    };
    let own = own_path(app);
    let mine = own.as_deref().map(|p| lookup(p, host, port, &key)).unwrap_or(Known::Unknown);
    if mine == Known::Match {
        return true;
    }
    let theirs = user_path().map(|p| lookup(&p, host, port, &key)).unwrap_or(Known::Unknown);
    if theirs == Known::Match && mine == Known::Unknown {
        return true;
    }
    if mine == Known::Changed || theirs == Known::Changed {
        return false; // 저장된 키와 다름 — 접속 거부
    }
    // 처음 보는 서버 — 자동으로 믿고 저장한다 (TOFU)
    if let Some(p) = own {
        let _ = save(&p, host, port, &key);
    }
    true
}
