// Windows 전용 — 저장할 FTP 비밀번호를 DPAPI로 암호화한다 (이 PC의 이 사용자만 풀 수 있음).
// 다른 OS에서는 "unsupported" 에러를 돌려준다.
// (idit_check: 리눅스에서 타입 검사만 할 때 Windows 코드를 함께 검사하는 cfg)

#[cfg(any(windows, idit_check))]
mod imp {
    use std::ffi::c_void;
    use std::ptr::{null, null_mut};

    #[repr(C)]
    struct DataBlob {
        cb_data: u32,
        pb_data: *mut u8,
    }

    #[link(name = "crypt32")]
    extern "system" {
        fn CryptProtectData(
            data_in: *const DataBlob,
            descr: *const u16,
            entropy: *const DataBlob,
            reserved: *mut c_void,
            prompt: *mut c_void,
            flags: u32,
            data_out: *mut DataBlob,
        ) -> i32;
        fn CryptUnprotectData(
            data_in: *const DataBlob,
            descr: *mut *mut u16,
            entropy: *const DataBlob,
            reserved: *mut c_void,
            prompt: *mut c_void,
            flags: u32,
            data_out: *mut DataBlob,
        ) -> i32;
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn LocalFree(mem: *mut c_void) -> *mut c_void;
    }

    const CRYPTPROTECT_UI_FORBIDDEN: u32 = 0x1;
    // 같은 PC의 다른 프로그램이 같은 사용자 권한으로 풀지 못하게 하는 추가 엔트로피.
    // iDrop/iDOT과 같은 값을 써서, 같은 PC에서라면 사이트를 옮겨 써도 암호문이 풀린다.
    const ENTROPY: &[u8] = b"iDOT.password.v1";

    pub fn protect(plain: &[u8]) -> Result<Vec<u8>, String> {
        let input = DataBlob {
            cb_data: plain.len() as u32,
            pb_data: plain.as_ptr() as *mut u8,
        };
        let ent = DataBlob {
            cb_data: ENTROPY.len() as u32,
            pb_data: ENTROPY.as_ptr() as *mut u8,
        };
        let mut out = DataBlob { cb_data: 0, pb_data: null_mut() };
        let ok = unsafe {
            CryptProtectData(&input, null(), &ent, null_mut(), null_mut(), CRYPTPROTECT_UI_FORBIDDEN, &mut out)
        };
        if ok == 0 {
            return Err("CryptProtectData failed".into());
        }
        let v = unsafe { std::slice::from_raw_parts(out.pb_data, out.cb_data as usize).to_vec() };
        unsafe { LocalFree(out.pb_data as *mut c_void) };
        Ok(v)
    }

    pub fn unprotect(cipher: &[u8]) -> Result<Vec<u8>, String> {
        let input = DataBlob {
            cb_data: cipher.len() as u32,
            pb_data: cipher.as_ptr() as *mut u8,
        };
        let ent = DataBlob {
            cb_data: ENTROPY.len() as u32,
            pb_data: ENTROPY.as_ptr() as *mut u8,
        };
        let mut out = DataBlob { cb_data: 0, pb_data: null_mut() };
        let ok = unsafe {
            CryptUnprotectData(&input, null_mut(), &ent, null_mut(), null_mut(), CRYPTPROTECT_UI_FORBIDDEN, &mut out)
        };
        if ok == 0 {
            return Err("CryptUnprotectData failed".into());
        }
        let v = unsafe { std::slice::from_raw_parts(out.pb_data, out.cb_data as usize).to_vec() };
        unsafe { LocalFree(out.pb_data as *mut c_void) };
        Ok(v)
    }
}

#[cfg(not(any(windows, idit_check)))]
mod imp {
    pub fn protect(_p: &[u8]) -> Result<Vec<u8>, String> {
        Err("unsupported".into())
    }
    pub fn unprotect(_c: &[u8]) -> Result<Vec<u8>, String> {
        Err("unsupported".into())
    }
}

use imp::{protect, unprotect};

use base64::Engine as _;

const PREFIX: &str = "dpapi:";

/// 평문 → "dpapi:<base64>" (이미 암호문이면 그대로, 빈 값은 빈 값)
pub fn protect_str(s: &str) -> Result<String, String> {
    if s.is_empty() || s.starts_with(PREFIX) {
        return Ok(s.to_string());
    }
    let c = protect(s.as_bytes())?;
    Ok(format!("{PREFIX}{}", base64::engine::general_purpose::STANDARD.encode(c)))
}

/// "dpapi:<base64>" → 평문 (암호문이 아니면 그대로). 풀 수 없으면 Err.
pub fn unprotect_str(s: &str) -> Result<String, String> {
    let Some(b64) = s.strip_prefix(PREFIX) else {
        return Ok(s.to_string());
    };
    let c = base64::engine::general_purpose::STANDARD
        .decode(b64)
        .map_err(|e| e.to_string())?;
    let p = unprotect(&c)?;
    String::from_utf8(p).map_err(|e| e.to_string())
}
