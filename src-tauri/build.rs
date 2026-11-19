fn main() {
    // On Windows, embed AfterGlow's own application manifest: Tauri's usual
    // one plus the package identity that the notification connector needs
    // once scripts/windows/register-package.ps1 has run (see the manifest).
    let windows = tauri_build::WindowsAttributes::new().app_manifest(include_str!("windows/app.manifest"));
    tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(windows)).expect("failed to run the Tauri build script");
}
