use std::io;

use tauri::{AppHandle, LogicalSize, Manager, Runtime, WebviewWindow, WebviewWindowBuilder};

const MIN_WINDOW_WIDTH: f64 = 480.0;
const MIN_WINDOW_HEIGHT: f64 = 360.0;
const MIN_VISIBLE_LENGTH: f64 = 64.0;
const DEFAULT_WINDOW_WIDTH: f64 = 800.0;
const DEFAULT_WINDOW_HEIGHT: f64 = 600.0;
const MAIN_WINDOW_LABEL: &str = "main";

pub(crate) const CENTER_WINDOW_MENU_ID: &str = "window-center";
pub(crate) const RESET_WINDOW_MENU_ID: &str = "window-reset";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum RecoveryCommand {
    Center,
    Reset,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Rect {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

impl Rect {
    const fn new(x: i32, y: i32, width: u32, height: u32) -> Self {
        Self {
            x,
            y,
            width,
            height,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct Display {
    work_area: Rect,
    scale_factor: f64,
}

impl Display {
    const fn new(work_area: Rect, scale_factor: f64) -> Self {
        Self {
            work_area,
            scale_factor,
        }
    }
}

fn is_usable_logical_size(width: f64, height: f64) -> bool {
    width >= MIN_WINDOW_WIDTH && height >= MIN_WINDOW_HEIGHT
}

fn has_meaningful_monitor_overlap(window: Rect, displays: &[Display]) -> bool {
    displays.iter().any(|display| {
        let intersection_width = overlap_length(
            window.x,
            window.width,
            display.work_area.x,
            display.work_area.width,
        );
        let intersection_height = overlap_length(
            window.y,
            window.height,
            display.work_area.y,
            display.work_area.height,
        );
        let required = (MIN_VISIBLE_LENGTH * display.scale_factor).ceil() as i64;

        intersection_width >= required && intersection_height >= required
    })
}

fn overlap_length(a_start: i32, a_length: u32, b_start: i32, b_length: u32) -> i64 {
    let start = i64::from(a_start).max(i64::from(b_start));
    let end =
        (i64::from(a_start) + i64::from(a_length)).min(i64::from(b_start) + i64::from(b_length));
    (end - start).max(0)
}

pub(crate) fn recovery_command_for_menu_id(id: &str) -> Option<RecoveryCommand> {
    match id {
        CENTER_WINDOW_MENU_ID => Some(RecoveryCommand::Center),
        RESET_WINDOW_MENU_ID => Some(RecoveryCommand::Reset),
        _ => None,
    }
}

pub(crate) fn reveal_main_window<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let window = get_or_create_main_window(app)?;
    if let Err(error) = window.unminimize() {
        log::warn!("failed to unminimize main window during reveal: {error}");
    }
    if let Err(error) = recover_invalid_geometry(&window) {
        log::warn!("failed to inspect main-window geometry during reveal: {error}");
    }
    show_and_focus(&window)
}

pub(crate) fn run_recovery_command<R: Runtime>(
    app: &AppHandle<R>,
    command: RecoveryCommand,
) -> tauri::Result<()> {
    let window = get_or_create_main_window(app)?;
    window.unminimize()?;

    match command {
        RecoveryCommand::Center => window.center()?,
        RecoveryCommand::Reset => reset_size_and_position(&window)?,
    }

    show_and_focus(&window)
}

fn get_or_create_main_window<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<WebviewWindow<R>> {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        return Ok(window);
    }

    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == MAIN_WINDOW_LABEL)
        .cloned()
        .ok_or_else(|| {
            tauri::Error::Io(io::Error::new(
                io::ErrorKind::NotFound,
                "main window configuration is missing",
            ))
        })?;

    WebviewWindowBuilder::from_config(app, &config)?.build()
}

fn recover_invalid_geometry<R: Runtime>(window: &WebviewWindow<R>) -> tauri::Result<()> {
    let scale_factor = window.scale_factor()?;
    let logical_size = window.inner_size()?.to_logical::<f64>(scale_factor);

    if !is_usable_logical_size(logical_size.width, logical_size.height) {
        log::warn!(
            "recovering unusable main-window size {:.0}x{:.0}",
            logical_size.width,
            logical_size.height
        );
        reset_size_and_position(window)?;
        return Ok(());
    }

    let monitors = match window.available_monitors() {
        Ok(monitors) => monitors,
        Err(error) => {
            log::warn!("could not enumerate monitors while recovering main window: {error}");
            return Ok(());
        }
    };
    if monitors.is_empty() {
        return Ok(());
    }

    let position = window.outer_position()?;
    let size = window.outer_size()?;
    let window_rect = Rect::new(position.x, position.y, size.width, size.height);
    let displays: Vec<_> = monitors
        .iter()
        .map(|monitor| {
            let area = monitor.work_area();
            Display::new(
                Rect::new(
                    area.position.x,
                    area.position.y,
                    area.size.width,
                    area.size.height,
                ),
                monitor.scale_factor(),
            )
        })
        .collect();

    if !has_meaningful_monitor_overlap(window_rect, &displays) {
        log::warn!("recentering main window that is outside connected displays");
        window.center()?;
    }

    Ok(())
}

fn reset_size_and_position<R: Runtime>(window: &WebviewWindow<R>) -> tauri::Result<()> {
    if window.is_fullscreen()? {
        window.set_fullscreen(false)?;
    }
    if window.is_maximized()? {
        window.unmaximize()?;
    }
    window.set_size(LogicalSize::new(
        DEFAULT_WINDOW_WIDTH,
        DEFAULT_WINDOW_HEIGHT,
    ))?;
    window.center()
}

fn show_and_focus<R: Runtime>(window: &WebviewWindow<R>) -> tauri::Result<()> {
    window.show()?;
    window.set_focus()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_the_persisted_two_pixel_window() {
        assert!(!is_usable_logical_size(2.0, 2.0));
    }

    #[test]
    fn accepts_the_minimum_supported_window_size() {
        assert!(is_usable_logical_size(480.0, 360.0));
    }

    #[test]
    fn rejects_a_window_wholly_outside_every_monitor() {
        let window = Rect::new(2000, 100, 800, 600);
        let monitors = [Display::new(Rect::new(0, 0, 1440, 900), 1.0)];

        assert!(!has_meaningful_monitor_overlap(window, &monitors));
    }

    #[test]
    fn accepts_a_sixty_four_pixel_visible_region() {
        let window = Rect::new(1376, 836, 800, 600);
        let monitors = [Display::new(Rect::new(0, 0, 1440, 900), 1.0)];

        assert!(has_meaningful_monitor_overlap(window, &monitors));
    }

    #[test]
    fn rejects_less_than_a_sixty_four_pixel_visible_region() {
        let window = Rect::new(1377, 837, 800, 600);
        let monitors = [Display::new(Rect::new(0, 0, 1440, 900), 1.0)];

        assert!(!has_meaningful_monitor_overlap(window, &monitors));
    }

    #[test]
    fn scales_the_required_visible_region_for_retina_displays() {
        let window = Rect::new(2752, 1672, 1600, 1200);
        let monitors = [Display::new(Rect::new(0, 0, 2880, 1800), 2.0)];

        assert!(has_meaningful_monitor_overlap(window, &monitors));
    }

    #[test]
    fn maps_only_window_recovery_menu_commands() {
        assert_eq!(
            recovery_command_for_menu_id("window-center"),
            Some(RecoveryCommand::Center)
        );
        assert_eq!(
            recovery_command_for_menu_id("window-reset"),
            Some(RecoveryCommand::Reset)
        );
        assert_eq!(recovery_command_for_menu_id("settings"), None);
    }
}
