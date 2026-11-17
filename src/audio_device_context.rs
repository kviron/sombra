//! Read-only endpoint metadata for the current Windows user session.
//! Never activates an audio endpoint, requests capture, or changes system settings.
use serde_json::Value;

#[tauri::command]
pub async fn audio_device_context() -> Result<Value, String> {
    #[cfg(windows)]
    {
        tauri::async_runtime::spawn_blocking(query_current_session)
            .await
            .map_err(|_| {
                "Не удалось проверить аудиоустройства текущего сеанса Windows.".to_string()
            })?
    }
    #[cfg(not(windows))]
    {
        Err("Проверка аудиоустройств сеанса доступна только в Windows.".to_string())
    }
}

#[cfg(windows)]
fn protocol_is_remote(protocol: u16) -> bool {
    // WTS: 0 = console, 1 = legacy ICA, 2 = RDP. Do not use SESSIONNAME.
    protocol != 0
}

#[cfg(windows)]
fn query_current_session() -> Result<Value, String> {
    use windows::core::PWSTR;
    use windows::Win32::Media::Audio::{
        eCapture, eConsole, eRender, IMMDeviceEnumerator, MMDeviceEnumerator, DEVICE_STATE_ACTIVE,
    };
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED,
    };
    use windows::Win32::System::RemoteDesktop::{
        WTSClientProtocolType, WTSFreeMemory, WTSQuerySessionInformationW, WTS_CURRENT_SESSION,
    };

    let query_error =
        || "Не удалось проверить аудиоустройства текущего сеанса Windows.".to_string();
    unsafe {
        let mut buffer = PWSTR::null();
        let mut bytes = 0;
        let result = WTSQuerySessionInformationW(
            None,
            WTS_CURRENT_SESSION,
            WTSClientProtocolType,
            &mut buffer,
            &mut bytes,
        );
        // WTS owns this allocation even if the returned payload is malformed.
        struct WtsBuffer(PWSTR);
        impl Drop for WtsBuffer {
            fn drop(&mut self) {
                if !self.0.is_null() {
                    unsafe { WTSFreeMemory(self.0 .0.cast()) };
                }
            }
        }
        let buffer = WtsBuffer(buffer);
        result.map_err(|_| query_error())?;
        if buffer.0.is_null() || bytes < std::mem::size_of::<u16>() as u32 {
            return Err(query_error());
        }
        let remote_session = protocol_is_remote(buffer.0 .0.read_unaligned());

        struct ComApartment(bool);
        impl Drop for ComApartment {
            fn drop(&mut self) {
                if self.0 {
                    unsafe { CoUninitialize() };
                }
            }
        }
        let initialized = CoInitializeEx(None, COINIT_MULTITHREADED);
        // RPC_E_CHANGED_MODE means an apartment already exists on this worker.
        // It remains usable, but belongs to its caller and must not be uninitialized here.
        let _apartment = if initialized.is_ok() {
            ComApartment(true) // Both S_OK and S_FALSE require a matching uninitialize.
        } else if initialized.0 == 0x80010106u32 as i32 {
            ComApartment(false)
        } else {
            return Err(query_error());
        };
        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).map_err(|_| query_error())?;
        let inputs = enumerator
            .EnumAudioEndpoints(eCapture, DEVICE_STATE_ACTIVE)
            .and_then(|devices| devices.GetCount())
            .map_err(|_| query_error())?;
        let outputs = enumerator
            .EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE)
            .and_then(|devices| devices.GetCount())
            .map_err(|_| query_error())?;
        let default_exists = |flow| -> Result<bool, String> {
            match enumerator.GetDefaultAudioEndpoint(flow, eConsole) {
                Ok(_) => Ok(true),
                Err(error) if error.code().0 == 0x80070490u32 as i32 => Ok(false),
                Err(_) => Err(query_error()),
            }
        };
        Ok(serde_json::json!({
            "remoteSession": remote_session,
            "inputs": inputs,
            "outputs": outputs,
            "defaultInput": default_exists(eCapture)?,
            "defaultOutput": default_exists(eRender)?,
        }))
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn wts_protocol_metadata() {
        assert!(!protocol_is_remote(0));
        assert!(protocol_is_remote(1));
        assert!(protocol_is_remote(2));
    }

    #[test]
    fn current_session_query_is_read_only_and_has_exact_contract() {
        // Enumerates metadata only: no endpoint activation or audio stream creation.
        let value = query_current_session().expect("current-session metadata query");
        let fields = value.as_object().expect("JSON object");
        assert_eq!(fields.len(), 5);
        for field in ["remoteSession", "defaultInput", "defaultOutput"] {
            assert!(fields[field].is_boolean(), "{field}");
        }
        for field in ["inputs", "outputs"] {
            assert!(
                fields[field].as_u64().is_some_and(|n| n <= u32::MAX as u64),
                "{field}"
            );
        }
    }
}
