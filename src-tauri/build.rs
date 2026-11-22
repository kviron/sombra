fn main() {
    // Windows cannot replace a running executable: close the previous dev build first.
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
            .expect("Could not run the preview cleanup");
        assert!(status.success(), "Could not close the previous Sombra preview");

        // Linking changes this file, so a rebuild checks for a running preview even
        // when no Rust source changed since the last successful build.
        let out = std::path::PathBuf::from(std::env::var_os("OUT_DIR").unwrap());
        let profile_dir = out.ancestors().nth(3).expect("Cargo profile directory");
        println!("cargo:rerun-if-changed={}", profile_dir.join("sombra.exe").display());
        println!("cargo:rerun-if-changed=prepare-build.ps1");
    }
    tauri_build::build()
}
