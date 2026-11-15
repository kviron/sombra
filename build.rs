fn main() {
    #[cfg(feature = "desktop")]
    desktop_build();
}

#[cfg(feature = "desktop")]
fn desktop_build() {
    // Craft Anything builds with Cargo directly, bypassing npm's prebuild hook.
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let status = std::process::Command::new("powershell.exe")
            .args([
                "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
                "-File", "prepare-build.ps1",
            ])
            .creation_flags(0x08000000) // CREATE_NO_WINDOW
            .status()
            .expect("Could not run Mines preview cleanup");
        assert!(status.success(), "Could not close the previous Mines preview");

        // Linking changes this file, so the next build checks for a running preview
        // even when no Rust source has changed since the last successful build.
        let out = std::path::PathBuf::from(std::env::var_os("OUT_DIR").unwrap());
        let profile_dir = out.ancestors().nth(3).expect("Cargo profile directory");
        println!("cargo:rerun-if-changed={}", profile_dir.join("mines-chat.exe").display());
        println!("cargo:rerun-if-changed=prepare-build.ps1");
    }
    tauri_build::build()
}
