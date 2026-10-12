use tauri::{
    image::Image,
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};

use crate::service_supervisor::ServiceSupervisor;

pub fn create_tray(app: &AppHandle, supervisor: ServiceSupervisor) -> Result<(), Box<dyn std::error::Error>> {
    // Desktop dedicated distinct tray icon
    let icon_bytes = include_bytes!("../icons/tray-desktop.png");
    let icon = Image::from_bytes(icon_bytes)?;

    let app_handle = app.clone();
    let supervisor_clone = supervisor.clone();

    // Menu construction
    let header_item = MenuItemBuilder::with_id("header", "omp-web Desktop (GUI)")
        .enabled(false)
        .build(app)?;
    let toggle_item = MenuItemBuilder::with_id("toggle", "显示 / 隐藏主窗口").build(app)?;
    let open_browser_item = MenuItemBuilder::with_id("open_browser", "在默认浏览器中打开").build(app)?;
    let restart_item = MenuItemBuilder::with_id("restart", "重启 ompweb 服务").build(app)?;
    let quit_item = MenuItemBuilder::with_id("quit", "退出客户端").build(app)?;

    let menu = MenuBuilder::new(app)
        .item(&header_item)
        .separator()
        .item(&toggle_item)
        .item(&open_browser_item)
        .item(&restart_item)
        .separator()
        .item(&quit_item)
        .build()?;

    let _tray = TrayIconBuilder::with_id("ompweb-desktop-tray")
        .icon(icon)
        // Explicit distinction in tray tooltip
        .tooltip("omp-web Desktop (GUI)")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(move |_tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                if let Some(window) = app_handle.get_webview_window("main") {
                    if window.is_visible().unwrap_or(false) {
                        let _ = window.hide();
                    } else {
                        let _ = window.show();
                        let _ = window.unminimize();
                        let _ = window.set_focus();
                    }
                }
            }
        })
        .on_menu_event(move |app, event| {
            match event.id().as_ref() {
                "toggle" => {
                    if let Some(window) = app.get_webview_window("main") {
                        if window.is_visible().unwrap_or(false) {
                            let _ = window.hide();
                        } else {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                    }
                }
                "open_browser" => {
                    let port = supervisor_clone.get_port();
                    let url = format!("http://127.0.0.1:{}", port);
                    let _ = open::that(url);
                }
                "restart" => {
                    let sup = supervisor_clone.clone();
                    let app_h = app.clone();
                    std::thread::spawn(move || {
                        log::info!("User triggered server restart from tray...");
                        if let Ok(port) = sup.restart() {
                            if let Some(window) = app_h.get_webview_window("main") {
                                let target_url = format!("http://127.0.0.1:{}", port);
                                if let Ok(parsed_url) = target_url.parse() {
                                    let _ = window.navigate(parsed_url);
                                }
                            }
                        }
                    });
                }
                "quit" => {
                    supervisor_clone.stop_service();
                    app.exit(0);
                }
                _ => {}
            }
        })
        .build(app)?;

    Ok(())
}
