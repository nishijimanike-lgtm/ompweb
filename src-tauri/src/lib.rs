pub mod service_supervisor;
pub mod tray;

use service_supervisor::ServiceSupervisor;
use tauri::{Manager, WindowEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let supervisor = ServiceSupervisor::new();
    let supervisor_exit = supervisor.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .setup({
            let supervisor = supervisor.clone();
            move |app| {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;

                // Window close interception: Hide to tray instead of closing
                if let Some(window) = app.get_webview_window("main") {
                    let win = window.clone();
                    window.on_window_event(move |event| {
                        if let WindowEvent::CloseRequested { api, .. } = event {
                            api.prevent_close();
                            let _ = win.hide();
                        }
                    });
                }

                // Initialize distinct desktop system tray
                tray::create_tray(app.handle(), supervisor.clone())?;

                // Launch or detect background ompweb service
                let app_handle = app.handle().clone();
                let sup = supervisor.clone();
                std::thread::spawn(move || {
                    match sup.ensure_service_started() {
                        Ok(port) => {
                            log::info!("ompweb service is healthy on port {}", port);
                            if let Some(window) = app_handle.get_webview_window("main") {
                                let target_url = format!("http://127.0.0.1:{}", port);
                                match target_url.parse() {
                                    Ok(parsed) => {
                                        if let Err(e) = window.navigate(parsed) {
                                            log::error!("Failed to navigate window to {}: {}", target_url, e);
                                        }
                                    }
                                    Err(e) => {
                                        log::error!("Failed to parse URL {}: {}", target_url, e);
                                    }
                                }
                                let _ = window.show();
                                let _ = window.unminimize();
                                let _ = window.set_focus();
                            }
                        }
                        Err(e) => {
                            log::error!("Failed to ensure ompweb service is running: {}", e);
                            if let Some(window) = app_handle.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.unminimize();
                                let _ = window.set_focus();
                            }
                        }
                    }
                });

                Ok(())
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(move |_app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                supervisor_exit.stop_service();
            }
        });
}
