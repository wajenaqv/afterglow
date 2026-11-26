// AfterGlow: live ASCII wallpapers behind the desktop icons.
//
// Layout (each file says more at the top):
//   host.rs      one wallpaper window per monitor, the cursor and pause loops
//   tray.rs      the tray menu (wallpaper, pause, start at login, settings, quit)
//   settings.rs  the saved choices (settings.json) and the Settings window's commands
//   signals.rs   the signal bus: signals in, reactions out to the wallpapers
//   apps.rs      the apps heard from: allowed or blocked, what each one does
//   jobs.rs      long work that says when it's done or needs you
//   claude.rs    Claude Code as a job, through its hooks
//   edge.rs      what's waiting as light at a screen edge, and the tray icon's colour
//   awake.rs     keep the computer awake, by hand or while chosen apps run
//   nowplaying.rs  what's playing, for the corner card (cover, title, rest to pause)
//   endpoint.rs  the local endpoint for signals (POST 127.0.0.1:47811/signal)
//   connectors/  watchers that turn other apps' activity into signals
//   extras.rs    wallpaper rotation and saving a still as a PNG
//   updates.rs   in-app updates: daily check, the tray line, restart to update
//   platform/    the per-OS part of putting a window behind the desktop icons
//   logfile.rs   the log (afterglow.log in the settings folder) and the alog! macro

#[macro_use]
pub mod logfile;
mod apps;
mod awake;
mod claude;
mod commands;
mod connectors;
mod edge;
mod endpoint;
mod extras;
mod host;
mod jobs;
mod nowplaying;
mod platform;
mod settings;
mod signals;
mod tray;
mod updates;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    logfile::init(env!("CARGO_PKG_VERSION"));
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
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(updates::Updates::default())
        .manage(host::Host::default())
        .manage(awake::Keeper::default())
        .manage(signals::Bus::default())
        .manage(edge::Edges::default())
        .manage(jobs::Jobs::default())
        .manage(nowplaying::NowPlaying::default())
        .manage(connectors::Connectors::default())
        // what the Settings window and the wallpapers call
        .invoke_handler(tauri::generate_handler![
            settings::get_settings,
            settings::set_wallpaper,
            settings::set_fps,
            settings::set_renderer,
            signals::send_signal,
            signals::signal_state,
            signals::wall_log,
            apps::apps_state,
            apps::set_app,
            apps::add_app,
            apps::set_new_apps,
            apps::finish_apps_setup,
            apps::preview_app,
            extras::set_rotation,
            jobs::jobs_state,
            jobs::set_jobs,
            jobs::forget_job,
            jobs::try_job,
            claude::connect_claude,
            edge::set_edge,
            edge::try_edge,
            awake::awake_state,
            awake::awake_apps,
            awake::set_awake,
            awake::set_awake_now,
            host::set_paused,
            host::power_state,
            host::wall_renderer,
            tray::set_pausing,
            tray::autostart_state,
            tray::set_autostart,
            signals::unread_by_app,
            signals::dismiss_lantern,
            signals::lantern_state,
            signals::activity_log,
            signals::clear_activity,
            connectors::steam::steam_state,
            connectors::steam::set_steam,
            extras::save_png,
            extras::open_stills_folder,
            extras::open_link,
            extras::set_clock,
            nowplaying::now_playing_state,
            nowplaying::set_now_playing,
            nowplaying::now_playing_toggle,
            settings::set_theme,
            settings::set_oled,
            updates::update_state,
            updates::check_update,
            updates::install_update,
            updates::set_check_updates,
            logfile::open_log,
            connectors::connectors_state,
            connectors::set_connector,
            connectors::accounts::accounts_state,
            connectors::accounts::set_client,
            connectors::accounts::account_sign_in,
            connectors::accounts::account_sign_out,
        ])
        .setup(|app| {
            // No Dock icon on macOS: AfterGlow lives in the menu bar
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            host::start(app.handle())?;
            tray::build(app.handle())?;
            awake::start(app.handle());
            edge::start(app.handle());
            jobs::start(app.handle());
            endpoint::start(app.handle());
            connectors::start(app.handle());
            extras::start_rotation(app.handle());
            nowplaying::start(app.handle());
            updates::start(app.handle());
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
            tauri::RunEvent::Exit => {
                crate::alog!("afterglow: exiting");
                host::stop(app)
            }
            _ => {}
        });
}
