// AfterGlow: live ASCII wallpapers behind the desktop icons.
//
// Layout (each file says more at the top):
//   host.rs      one wallpaper window per monitor, the cursor and pause loops
//   tray.rs      the tray menu (pause, start at login, settings, quit)
//   platform/    the per-OS part of putting a window behind the desktop icons

mod host;
mod platform;
mod tray;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // A second launch just opens the settings window of the running one,
        // instead of stacking a second set of wallpapers
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            tray::show_settings(app);
        }))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .manage(host::Host::default())
        .setup(|app| {
            // No Dock icon on macOS: AfterGlow lives in the menu bar
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            host::start(app.handle())?;
            tray::build(app.handle())?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building afterglow")
        .run(|app, event| match event {
            // Windows closing (Settings, or the wallpapers while monitors are
            // rebuilt) never quits AfterGlow; only Quit in the tray does
            // (that one comes with an exit code)
            tauri::RunEvent::ExitRequested { code: None, api, .. } => api.prevent_exit(),
            // Leave the normal desktop wallpaper behind when quitting
            tauri::RunEvent::Exit => host::stop(app),
            _ => {}
        });
}
