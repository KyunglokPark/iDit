// 파일 내용 인코딩 변환 — "인코딩 지정해서 열기/저장"에서 쓴다.
use encoding_rs::Encoding;
use serde::Serialize;

#[tauri::command]
pub fn decode_text(bytes: Vec<u8>, encoding: String) -> Result<String, String> {
    let enc = Encoding::for_label(encoding.as_bytes()).ok_or_else(|| format!("알 수 없는 인코딩: {encoding}"))?;
    let (text, _, _) = enc.decode(&bytes);
    Ok(text.into_owned())
}

#[derive(Serialize)]
pub struct EncodeResult {
    pub bytes: Vec<u8>,
    pub had_errors: bool,
}

#[tauri::command]
pub fn encode_text(text: String, encoding: String) -> Result<EncodeResult, String> {
    let enc = Encoding::for_label(encoding.as_bytes()).ok_or_else(|| format!("알 수 없는 인코딩: {encoding}"))?;
    let (bytes, _, had_errors) = enc.encode(&text);
    Ok(EncodeResult { bytes: bytes.into_owned(), had_errors })
}
