//! FarmForever (formerly Azeroth Farm Atlas) – Tauri 2 desktop backend.

pub mod commands {
    pub mod farm;
    pub mod maps;
    pub mod markets;
    pub mod profiles;
    pub mod sessions;
    pub mod settings;
}
pub mod db;
pub mod error;
pub mod i18n;
pub mod market;
pub mod security {
    pub mod credentials;
    pub mod network_policy;
}
pub mod state;
pub mod wowclient;

use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let seed = app.path().resolve("resources/seed.db", tauri::path::BaseDirectory::Resource)?;
            let manifest = app.path().resolve("resources/data-manifest.json", tauri::path::BaseDirectory::Resource)?;
            match state::AppState::init(data_dir, &seed, &manifest) {
                Ok(s) => {
                    // imported map images are served via the asset protocol – only from this one folder, not recursive
                    let _ = std::fs::create_dir_all(&s.paths.maps_dir);
                    if let Err(e) = app.asset_protocol_scope().allow_directory(&s.paths.maps_dir, false) {
                        eprintln!("asset scope for maps not set: {e}");
                    }
                    if let Ok(settings) = db::user::get_settings(&*s.user()?) {
                        i18n::set_language(&settings.language);
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.set_always_on_top(settings.always_on_top);
                        }
                    }
                    app.manage(s);
                    Ok(())
                }
                Err(e) => {
                    use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
                    app.dialog()
                        .message(crate::i18n::tr(format!("FarmForever konnte die lokalen Daten nicht öffnen:\n\n{}\n\nDatenordner: %APPDATA%\\de.azerothfarmatlas.desktop", e.message), format!("FarmForever could not open its local data:\n\n{}\n\nData folder: %APPDATA%\\de.azerothfarmatlas.desktop", e.message)))
                        .kind(MessageDialogKind::Error)
                        .title(crate::i18n::tr("Startfehler", "Startup error"))
                        .blocking_show();
                    Err(Box::new(e))
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::farm::app_info,
            commands::farm::search_spots,
            commands::farm::get_spot,
            commands::farm::get_item,
            commands::farm::get_npc,
            commands::farm::search,
            commands::farm::list_zones,
            commands::farm::zone_layer,
            commands::farm::list_sources,
            commands::farm::get_coverage,
            commands::maps::zone_density,
            commands::maps::get_map_asset,
            commands::maps::list_map_assets,
            commands::maps::import_map_image,
            commands::maps::import_map_folder,
            commands::maps::set_map_calibration,
            commands::maps::delete_map_asset,
            commands::maps::detect_wow_clients,
            commands::maps::pick_wow_client,
            commands::maps::import_client_maps,
            commands::profiles::list_profiles,
            commands::profiles::save_profile,
            commands::profiles::delete_profile,
            commands::profiles::duplicate_profile,
            commands::profiles::set_active_profile,
            commands::profiles::export_profile,
            commands::profiles::import_profile,
            commands::sessions::start_session,
            commands::sessions::session_action,
            commands::sessions::patch_session,
            commands::sessions::list_sessions,
            commands::sessions::delete_session,
            commands::sessions::export_sessions,
            commands::markets::list_markets,
            commands::markets::fetch_quotes,
            commands::markets::fetch_quote_detail,
            commands::markets::fetch_crafting,
            commands::markets::sync_market_prices,
            commands::markets::cancel_market_sync,
            commands::markets::get_market_sync_status,
            commands::markets::provider_health,
            commands::markets::cached_provider_health,
            commands::markets::set_credential,
            commands::markets::delete_credential,
            commands::markets::credential_status,
            commands::markets::clear_price_cache,
            commands::markets::set_manual_price,
            commands::markets::delete_manual_price,
            commands::markets::list_manual_prices,
            commands::settings::get_settings,
            commands::settings::save_settings,
            commands::settings::toggle_favorite,
            commands::settings::list_favorites,
            commands::settings::toggle_watch,
            commands::settings::list_watchlist,
            commands::settings::backup_user_data,
            commands::settings::reset_local_data,
        ])
        .run(tauri::generate_context!())
        .expect("error while running FarmForever");
}
