use std::path::Path;
#[cfg(windows)]
fn crypt(data: &[u8], encrypt: bool) -> Result<Vec<u8>, String> {
    use windows::{core::PCWSTR, Win32::{Foundation::{LocalFree,HLOCAL}, Security::Cryptography::{CryptProtectData,CryptUnprotectData,CRYPT_INTEGER_BLOB}}};
    let input = CRYPT_INTEGER_BLOB { cbData: data.len() as u32, pbData: data.as_ptr() as *mut u8 };
    let mut output = CRYPT_INTEGER_BLOB::default();
    unsafe {
        if encrypt { CryptProtectData(&input, PCWSTR::null(), None, None, None, 1, &mut output) }
        else { CryptUnprotectData(&input, None, None, None, None, 1, &mut output) }.map_err(|_| "Не удалось защитить сессию Windows")?;
        let result = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        let _ = LocalFree(Some(HLOCAL(output.pbData as *mut _)));
        Ok(result)
    }
}
#[cfg(not(windows))]
fn crypt(_: &[u8], _: bool) -> Result<Vec<u8>, String> { Err("Session persistence requires Windows".into()) }
pub fn load(path: &Path) -> String {
    std::fs::read(path).ok().and_then(|bytes|crypt(&bytes,false).ok()).and_then(|bytes|String::from_utf8(bytes).ok()).unwrap_or_default()
}
pub fn save(path: &Path, cookie: &str) -> Result<(), String> {
    if cookie.is_empty() || cookie == "mines_session=" { let _=std::fs::remove_file(path); return Ok(()); }
    let encrypted=crypt(cookie.as_bytes(),true)?;
    std::fs::create_dir_all(path.parent().ok_or("Session directory missing")?).map_err(|_|"Session directory unavailable")?;
    std::fs::write(path,encrypted).map_err(|_|"Не удалось сохранить вход".into())
}
