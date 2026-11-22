use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    App, AppHandle, Manager, WindowEvent,
};

pub fn setup(app: &App) -> tauri::Result<()> {
    let (Some(window), Some(icon)) = (app.get_webview_window("main"), app.default_window_icon())
    else {
        return Ok(());
    };
    let open = MenuItem::with_id(app, "open", "Открыть Sombra", true, None::<&str>)?;
    let exit = MenuItem::with_id(app, "exit", "Выйти из Sombra", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &exit])?;

    TrayIconBuilder::with_id("sombra")
        .icon(icon.clone())
        .tooltip("Sombra")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => restore(app),
            "exit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|icon, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                restore(icon.app_handle());
            }
        })
        .build(app)?;

    let main_window = window.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            if main_window.hide().is_ok() {
                api.prevent_close();
            }
        }
    });
    Ok(())
}

fn restore(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show().and_then(|()| window.unminimize()).and_then(|()| window.set_focus());
    }
}
