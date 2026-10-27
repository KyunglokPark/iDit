// iDit — 코드 에디터 백엔드.
// 파일 열기/저장(로컬)은 tauri-plugin-dialog + tauri-plugin-fs로 처리하고,
// FTP/SFTP 열기/저장은 ftp.rs / sftp_session.rs로 처리한다.
// 메뉴바는 네이티브 OS 메뉴 대신 프런트엔드의 커스텀 인앱 메뉴바(menu.ts)를 쓴다
// (iDrop/iDOT과 같은 로고+메뉴 스트립). 모든 동작은 JS 쪽에서 수행한다.

mod encoding;
mod ftp;
mod hostkey;
#[allow(dead_code)] // iDrop에서 그대로 가져온 모듈 — iDit은 일부 연산만 쓴다
mod sftp;
mod sftp_session;
#[allow(dead_code)] // win.rs의 일부(파일 대화상자용 메뉴 열기 등)는 현재 미사용
mod win;

use ftp::FtpState;
use sftp_session::SftpState;

/// 저장할 FTP 비밀번호 암호화 (Windows DPAPI — 이 PC의 이 사용자만 풀 수 있다)
#[tauri::command]
fn secret_protect(values: Vec<String>) -> Result<Vec<String>, String> {
    values.iter().map(|v| win::protect_str(v)).collect()
}

/// 저장된 비밀번호 풀기. 풀 수 없는 값은 빈 문자열.
#[tauri::command]
fn secret_unprotect(values: Vec<String>) -> Vec<String> {
    values.iter().map(|v| win::unprotect_str(v).unwrap_or_default()).collect()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(FtpState::default())
        .manage(SftpState::default())
        .invoke_handler(tauri::generate_handler![
            ftp::ftp_connect,
            ftp::ftp_disconnect,
            ftp::ftp_pwd,
            ftp::ftp_list,
            ftp::ftp_read_file,
            ftp::ftp_write_file,
            sftp_session::sftp_connect,
            sftp_session::sftp_disconnect,
            sftp_session::sftp_pwd,
            sftp_session::sftp_list,
            sftp_session::sftp_read_file,
            sftp_session::sftp_write_file,
            secret_protect,
            secret_unprotect,
            encoding::decode_text,
            encoding::encode_text,
        ])
        .setup(|app| {
            // 창 타이틀바/작업표시줄 아이콘을 실행 시 직접 지정한다.
            // (exe에 임베드되는 아이콘은 빌드 캐시로 옛 아이콘이 남을 수 있어,
            //  런타임에 새 PNG로 덮어써서 항상 최신 아이콘이 뜨게 한다.)
            use tauri::Manager;
            if let Some(win) = app.get_webview_window("main") {
                if let Ok(icon) = tauri::image::Image::from_bytes(include_bytes!("../icons/128x128.png")) {
                    let _ = win.set_icon(icon);
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
