use std::io;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

use tauri::utils::config::WindowConfig;
use tauri::{
    AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, Runtime, WebviewWindow,
    WebviewWindowBuilder,
};

use crate::state::AppState;

const MIN_WINDOW_WIDTH: f64 = 480.0;
const MIN_WINDOW_HEIGHT: f64 = 360.0;
const MIN_VISIBLE_LENGTH: f64 = 64.0;
const DEFAULT_WINDOW_WIDTH: f64 = 800.0;
const DEFAULT_WINDOW_HEIGHT: f64 = 600.0;
/// The label tauri gives the window declared in `tauri.conf.json`. Only the
/// *first* window uses it; every window opened at runtime gets a generated
/// label, so nothing below may assume "main" is the window in play.
const MAIN_WINDOW_LABEL: &str = "main";
/// Logical-pixel cascade step between a window and the window opened from it
/// (reference behavior S1.6 — new windows are offset, not stacked).
const CASCADE_STEP_LOGICAL: f64 = 32.0;
/// Rerolls before accepting a generated label without checking it. 122 bits of
/// randomness means one collision is already implausible; eight are not worth
/// failing an open over.
const LABEL_ATTEMPTS: usize = 8;

pub(crate) const CENTER_WINDOW_MENU_ID: &str = "window-center";
pub(crate) const RESET_WINDOW_MENU_ID: &str = "window-reset";
pub(crate) const NEW_WINDOW_MENU_ID: &str = "window-new";

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

/// Area of the intersection between `self` and `other`, in square pixels.
///
/// Used to decide which display a window "belongs to" when it straddles two.
impl Rect {
    fn overlap_area(&self, other: &Rect) -> i64 {
        overlap_length(self.x, self.width, other.x, other.width)
            * overlap_length(self.y, self.height, other.y, other.height)
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

/// Deliver a menu-driven event to exactly one window.
///
/// A menu bar command acts on the window the user is looking at. `app.emit`
/// broadcasts, so clicking Settings… used to pop the modal in *every* window
/// and Check for Updates… used to start one check per window (reference
/// behavior S1.3 — windows must not cross-talk). `emit_to` addresses a single
/// label instead.
///
/// Note the frontend has to meet this halfway: a JS `listen()` registers with
/// `EventTarget::Any`, which Tauri delivers to unconditionally regardless of
/// the emit target. The listeners for these events use the current webview
/// window's labelled `listen`, which is what makes the address stick.
pub(crate) fn emit_menu_event<R: Runtime>(app: &AppHandle<R>, event: &str) {
    let Some(label) = menu_target_label(app) else {
        // No window at all (macOS: last window closed, app still running).
        // Nothing to open the modal in — dropping is the correct outcome.
        log::warn!("no window to deliver menu event {event} to");
        return;
    };
    if let Err(error) = app.emit_to(label.as_str(), event, ()) {
        log::error!("failed to emit menu event {event} to {label}: {error}");
    }
}

/// Label of the window a menu command should act on.
pub(crate) fn menu_target_label<R: Runtime>(app: &AppHandle<R>) -> Option<String> {
    let windows = app.webview_windows();
    // Sorted so the fallback is deterministic rather than HashMap-order.
    let mut labels: Vec<String> = windows.keys().cloned().collect();
    labels.sort();
    // `Manager::get_focused_window` sits behind tauri's `unstable` feature, so
    // ask each window instead — in label order, so the answer stays stable if a
    // platform ever reports two windows as focused.
    let focused = labels
        .iter()
        .find(|label| {
            windows
                .get(*label)
                .and_then(|window| window.is_focused().ok())
                .unwrap_or(false)
        })
        .cloned();
    select_menu_target(focused.as_deref(), &labels)
}

/// Prefer the focused window; otherwise pick one deterministically.
///
/// Clicking a menu item focuses the app, so `focused` is normally populated.
/// When it isn't (or names a window with no webview), we still target a single
/// label rather than falling back to a broadcast — a menu item that quietly
/// acts on one window is recoverable, one that acts on all of them is the
/// cross-talk this piece exists to remove.
fn select_menu_target(focused: Option<&str>, labels: &[String]) -> Option<String> {
    if let Some(focused) = focused {
        if labels.iter().any(|label| label == focused) {
            return Some(focused.to_string());
        }
    }
    labels.first().cloned()
}

/// Bring the window the user should end up looking at to the front.
///
/// Used by the app-launch path, the second-launch (single-instance) handler and
/// the macOS Dock reopen. With more than one window open this must *not* mean
/// "main": the user's last window may be any of them, and hoisting `main`
/// unbidden would reorder windows behind the user's back (S1.1 — the existing
/// windows are untouched). Falls back to creating the configured window only
/// when there is none left, which is the macOS zero-window state (S3.4).
pub(crate) fn reveal_active_window<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let window = active_or_new_main_window(app)?;
    reveal(&window)
}

/// Show, unminimize and focus `window`, repairing unusable geometry on the way.
fn reveal<R: Runtime>(window: &WebviewWindow<R>) -> tauri::Result<()> {
    let label = window.label().to_string();
    if let Err(error) = window.unminimize() {
        log::warn!("failed to unminimize {label} during reveal: {error}");
    }
    if let Err(error) = recover_invalid_geometry(window) {
        log::warn!("failed to inspect {label} geometry during reveal: {error}");
    }
    show_and_focus(window)
}

/// Reveal one specific window — the focus half of focus-instead-of-duplicate
/// (S1.5). Errors when `label` names no live window, so a stale label from the
/// frontend can't silently do nothing *and* report success.
pub(crate) fn focus_labelled_window<R: Runtime>(
    app: &AppHandle<R>,
    label: &str,
) -> tauri::Result<()> {
    let window = app.get_webview_window(label).ok_or_else(|| {
        tauri::Error::Io(io::Error::new(
            io::ErrorKind::NotFound,
            format!("no window labelled {label}"),
        ))
    })?;
    reveal(&window)
}

/// Label of another window that already has `path` open as its vault, for
/// focus-instead-of-duplicate (S1.5). `None` means "nobody else has it, go
/// ahead and open it here" — including when the asking window is the one
/// holding it, so re-opening the current vault still reloads normally.
pub(crate) fn other_window_with_vault(
    state: &AppState,
    requester: &str,
    path: &Path,
) -> Option<String> {
    state.find_by_vault_excluding(path, requester)
}

/// Geometry recovery acts on the window the user is looking at. The menu item
/// lives in the Window menu, which on macOS is scoped to the active window.
pub(crate) fn run_recovery_command<R: Runtime>(
    app: &AppHandle<R>,
    command: RecoveryCommand,
) -> tauri::Result<()> {
    let window = active_or_new_main_window(app)?;
    window.unminimize()?;

    match command {
        RecoveryCommand::Center => window.center()?,
        RecoveryCommand::Reset => reset_size_and_position(&window)?,
    }

    show_and_focus(&window)
}

/// The focused (or, failing that, deterministically chosen) live window;
/// creates the configured main window when the app has none.
fn active_or_new_main_window<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<WebviewWindow<R>> {
    if let Some(window) = menu_target_label(app).and_then(|label| app.get_webview_window(&label)) {
        // Registering an already-live label keeps its existing state; it only
        // matters for a window that outlived a `remove` tombstone.
        app.state::<AppState>().register(window.label());
        return Ok(window);
    }
    get_or_create_main_window(app)
}

fn get_or_create_main_window<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<WebviewWindow<R>> {
    // Claim per-window state for this label before handing the window back.
    // `register` is also what clears the tombstone left by a previous window
    // with the same label, so a window reopened from the Dock after its
    // predecessor was destroyed gets working state instead of the detached
    // state a late in-flight command would see.
    app.state::<AppState>().register(MAIN_WINDOW_LABEL);

    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        return Ok(window);
    }

    let config = main_window_config(app).ok_or_else(|| {
        tauri::Error::Io(io::Error::new(
            io::ErrorKind::NotFound,
            "main window configuration is missing",
        ))
    })?;

    WebviewWindowBuilder::from_config(app, &config)?.build()
}

/// Open an additional editor window (File > New Window / Cmd+Shift+N, S1.1).
///
/// The window is built from the same `tauri.conf.json` config as the first one —
/// same size, title bar style, traffic-light inset — with the label rewritten
/// and centering turned off, then explicitly offset from the window it was
/// opened from (S1.6).
pub(crate) fn open_new_window<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<WebviewWindow<R>> {
    // Resolve the source window *before* the new one exists, or "the focused
    // window" could resolve to the window being created.
    let source = menu_target_label(app).and_then(|label| app.get_webview_window(&label));
    let label = allocate_window_label(|candidate| app.get_webview_window(candidate).is_some());
    let config = new_window_config(main_window_config(app).as_ref(), label.clone());
    let builder = WebviewWindowBuilder::from_config(app, &config)?;

    // Claim state before the webview exists: its first IPC call can otherwise
    // arrive before we get back here.
    app.state::<AppState>().register(&label);
    let window = match builder.build() {
        Ok(window) => window,
        Err(error) => {
            // A window that never existed will never emit `Destroyed`, so the
            // claim has to be released here or the label (and anything a
            // half-built webview managed to store under it) leaks for the life
            // of the process.
            release_window_state(app.state::<AppState>().inner(), &label);
            return Err(error);
        }
    };

    offset_from_source(&window, source.as_ref());
    log::info!("opened window {label}");
    Ok(window)
}

/// What a close request should do to the window it came from.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum CloseAction {
    /// Keep the window alive but invisible. Only correct for the *last* window
    /// on macOS, where the app stays running with no window open (S3.4) and the
    /// hidden window is what Dock Reopen and the Window menu reveal.
    Hide,
    /// Take the window down. This is what makes tauri deliver
    /// `WindowEvent::Destroyed`, and therefore what runs the S3.1/S3.2 teardown.
    Destroy,
}

/// Hide or destroy, given the platform and how many windows are still up.
///
/// The frontend has to intercept close-requested to flush the pending autosave,
/// and merely *having* a JS close-requested listener makes tauri prevent the
/// close for that label — so this is the code that actually finishes it. Hiding
/// unconditionally on macOS (what the frontend used to do) means no window is
/// ever destroyed: `Destroyed` never fires, `on_window_destroyed` never runs,
/// and every closed window keeps its FSEvents subscription, its autosave loop
/// and its claim on its vault — which then bounces the next open of that vault
/// to a window the user cannot see (S1.5 → `focus_labelled_window` un-hides it).
///
/// A count of zero (or one that raced with another window's close) errs toward
/// Hide on macOS, which is the recoverable direction: an extra live window is a
/// hidden window the user can reopen, while destroying the last one leaves the
/// app running with nothing to reveal but a freshly built window.
fn close_action(is_macos: bool, live_windows: usize) -> CloseAction {
    if is_macos && live_windows <= 1 {
        CloseAction::Hide
    } else {
        CloseAction::Destroy
    }
}

/// Finish a close the frontend intercepted (S3.1–S3.4).
pub(crate) fn close_window<R: Runtime>(
    app: &AppHandle<R>,
    window: &WebviewWindow<R>,
) -> tauri::Result<()> {
    let action = close_action(cfg!(target_os = "macos"), app.webview_windows().len());
    apply_close_action(app.state::<AppState>().inner(), window, action)
}

fn apply_close_action<R: Runtime>(
    state: &AppState,
    window: &WebviewWindow<R>,
    action: CloseAction,
) -> tauri::Result<()> {
    match action {
        CloseAction::Hide => {
            log::info!("hiding last window {}", window.label());
            window.hide()
        }
        CloseAction::Destroy => {
            // Destroy first: a failed destroy leaves the window on screen, and
            // a live window with no state can neither read nor watch its vault.
            window.destroy()?;
            // If this window was running the agent, its `claude` subprocess has
            // just lost the only UI attached to it — kill it and hand the
            // single-owner lock back (S3.2: no orphaned process).
            crate::commands::agents::shutdown_session_if_owned(
                &window.app_handle().clone(),
                window.label(),
            );
            // The `Destroyed` run event releases this too (and is what covers
            // closes that never come through here — a native close in a window
            // whose webview never registered the handler). Releasing here as
            // well makes teardown ordered with the close the user asked for
            // instead of with an event that only fires if the platform agrees.
            release_window_state(state, window.label());
            Ok(())
        }
    }
}

/// Reclaim a destroyed window's state (S3.1, S3.2).
///
/// Dropping the removed `Arc<WindowState>` is what releases that window's
/// FSEvents subscription; removal is per label, so the surviving window keeps
/// its own watcher and stays fully functional.
/// Covers closes that never went through `close_window` too — a native close in
/// a window whose webview never registered the close handler — which is why the
/// agent shutdown is repeated here rather than only in `apply_close_action`.
/// Both calls are idempotent: the second finds no session it owns.
pub(crate) fn on_window_destroyed<R: Runtime>(app: &AppHandle<R>, label: &str) {
    crate::commands::agents::shutdown_session_if_owned(app, label);
    release_window_state(app.state::<AppState>().inner(), label);
}

fn release_window_state(state: &AppState, label: &str) {
    match state.remove(label) {
        // The drop — not the map removal — is the teardown: it runs
        // `Debouncer::drop`, which joins the debounce thread and unsubscribes.
        Some(removed) => {
            drop(removed);
            log::debug!("released state for destroyed window {label}");
        }
        // Already reclaimed, or a window that never had state (nothing to do).
        None => log::debug!("destroyed window {label} had no state to release"),
    }
}

fn main_window_config<R: Runtime>(app: &AppHandle<R>) -> Option<WindowConfig> {
    let windows = &app.config().app.windows;
    windows
        .iter()
        .find(|window| window.label == MAIN_WINDOW_LABEL)
        .or_else(|| windows.first())
        .cloned()
}

/// The config for a runtime-created window: the configured window, relabelled.
///
/// Cloning the config (rather than hand-rolling a builder) is what keeps a new
/// window identical to the first one as `tauri.conf.json` evolves. `base` is
/// `None` only if the config declares no windows at all, in which case tauri's
/// defaults are a better outcome than refusing to open.
fn new_window_config(base: Option<&WindowConfig>, label: String) -> WindowConfig {
    let mut config = base.cloned().unwrap_or_default();
    config.label = label;
    // Centering is what makes windows stack exactly on top of each other; the
    // cascade offset is applied after build instead (S1.6).
    config.center = false;
    config.x = None;
    config.y = None;
    // A window the user explicitly asked for must appear and take focus, even
    // if the configured first window is created hidden.
    config.visible = true;
    config.focus = true;
    config
}

/// Position `window` one cascade step from the window it was opened from.
///
/// Best effort throughout: a window that ends up wherever the OS put it is a
/// cosmetic problem, while failing the open over a geometry query is not.
fn offset_from_source<R: Runtime>(window: &WebviewWindow<R>, source: Option<&WebviewWindow<R>>) {
    let Some(source) = source else {
        // First window of the session — nothing to cascade from.
        return;
    };
    let (Ok(origin), Ok(size)) = (source.outer_position(), window.outer_size()) else {
        log::warn!("no geometry to offset window {}", window.label());
        return;
    };
    let source_rect = Rect::new(origin.x, origin.y, size.width, size.height);
    let (x, y) = cascade_position(source_rect, &displays_of(source));
    if let Err(error) = window.set_position(PhysicalPosition::new(x, y)) {
        log::warn!("failed to offset new window {}: {error}", window.label());
    }
}

/// Where to put a window opened from a window occupying `source`.
///
/// Physical pixels in and out, because that is what `outer_position` and
/// `Monitor::work_area` speak. The step is scaled by the display's factor so
/// the visible offset is the same on retina and non-retina screens.
fn cascade_position(source: Rect, displays: &[Display]) -> (i32, i32) {
    let home = home_display(source, displays);
    let scale = home.map_or(1.0, |display| display.scale_factor);
    let step = (CASCADE_STEP_LOGICAL * scale).round() as i32;
    let cascaded = Rect::new(
        source.x.saturating_add(step),
        source.y.saturating_add(step),
        source.width,
        source.height,
    );

    // With no monitor information (headless, or a platform that won't say) the
    // offset is still the right answer — it just can't be validated.
    if displays.is_empty() || has_meaningful_monitor_overlap(cascaded, displays) {
        return (cascaded.x, cascaded.y);
    }

    // The cascade walked off the screen. Restart near the top-left of the
    // window's own display, still offset so it doesn't hide the window it came
    // from if that one is at the origin.
    let Some(home) = home else {
        return (cascaded.x, cascaded.y);
    };
    let wrapped = Rect::new(
        home.work_area.x.saturating_add(step),
        home.work_area.y.saturating_add(step),
        source.width,
        source.height,
    );
    if has_meaningful_monitor_overlap(wrapped, displays) {
        (wrapped.x, wrapped.y)
    } else {
        // A display too small to hold even an offset window: at least stay on it.
        (home.work_area.x, home.work_area.y)
    }
}

/// The display a window mostly sits on, or the first one if it sits on none.
fn home_display(window: Rect, displays: &[Display]) -> Option<&Display> {
    displays
        .iter()
        .max_by_key(|display| window.overlap_area(&display.work_area))
        .filter(|display| window.overlap_area(&display.work_area) > 0)
        .or_else(|| displays.first())
}

fn displays_of<R: Runtime>(window: &WebviewWindow<R>) -> Vec<Display> {
    let monitors = match window.available_monitors() {
        Ok(monitors) => monitors,
        Err(error) => {
            log::warn!("could not enumerate monitors: {error}");
            return Vec::new();
        }
    };
    monitors
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
        .collect()
}

/// A label no live window is using. Uuid-shaped so labels are never reused
/// across windows: reusing one would hand a new window the tombstone (or the
/// leftovers) of its predecessor's state.
fn allocate_window_label(is_taken: impl Fn(&str) -> bool) -> String {
    let mut label = new_window_label();
    for _ in 0..LABEL_ATTEMPTS {
        if !is_taken(&label) {
            return label;
        }
        log::warn!("generated window label {label} was already taken; rerolling");
        label = new_window_label();
    }
    label
}

fn new_window_label() -> String {
    format!("w-{}", uuid_v4())
}

/// Random v4 uuid. Hand-rolled rather than pulling in the `uuid` crate for one
/// call site; `getrandom` is already a dependency.
fn uuid_v4() -> String {
    let mut bytes = [0u8; 16];
    if getrandom::getrandom(&mut bytes).is_err() {
        // No system RNG. A constant label would collide with the next window
        // and share its state, so fall back to something still unique within
        // this process.
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let counter = COUNTER.fetch_add(1, Ordering::Relaxed);
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|elapsed| elapsed.as_nanos() as u64)
            .unwrap_or(0);
        bytes[..8].copy_from_slice(&counter.to_le_bytes());
        bytes[8..].copy_from_slice(&nanos.to_le_bytes());
    }
    // Version 4, variant 1 — cosmetic, but it makes the label recognizable.
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    let hex: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
    format!(
        "{}-{}-{}-{}-{}",
        &hex[0..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..32]
    )
}

fn recover_invalid_geometry<R: Runtime>(window: &WebviewWindow<R>) -> tauri::Result<()> {
    let scale_factor = window.scale_factor()?;
    let logical_size = window.inner_size()?.to_logical::<f64>(scale_factor);

    if !is_usable_logical_size(logical_size.width, logical_size.height) {
        log::warn!(
            "recovering unusable size {:.0}x{:.0} for window {}",
            logical_size.width,
            logical_size.height,
            window.label()
        );
        reset_size_and_position(window)?;
        return Ok(());
    }

    let displays = displays_of(window);
    if displays.is_empty() {
        return Ok(());
    }

    let position = window.outer_position()?;
    let size = window.outer_size()?;
    let window_rect = Rect::new(position.x, position.y, size.width, size.height);

    if !has_meaningful_monitor_overlap(window_rect, &displays) {
        log::warn!(
            "recentering window {} that is outside connected displays",
            window.label()
        );
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
    use notify::RecommendedWatcher;
    use notify::{RecursiveMode, Watcher};
    use notify_debouncer_full::{new_debouncer, Debouncer, FileIdMap};
    use std::cell::Cell;
    use std::collections::HashSet;
    use std::sync::Arc;
    use std::time::Duration;
    use tempfile::{tempdir, TempDir};

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

    fn labels(names: &[&str]) -> Vec<String> {
        names.iter().map(|name| name.to_string()).collect()
    }

    #[test]
    fn a_menu_command_targets_the_focused_window() {
        // S1.3: Settings… clicked while window B has focus must open in B only.
        assert_eq!(
            select_menu_target(Some("b"), &labels(&["a", "b"])),
            Some("b".to_string())
        );
        assert_eq!(
            select_menu_target(Some("a"), &labels(&["a", "b"])),
            Some("a".to_string())
        );
    }

    #[test]
    fn a_menu_command_with_no_focus_still_targets_one_window() {
        assert_eq!(
            select_menu_target(None, &labels(&["a", "b"])),
            Some("a".to_string())
        );
        // A focused label with no matching webview window is not a valid target.
        assert_eq!(
            select_menu_target(Some("ghost"), &labels(&["a", "b"])),
            Some("a".to_string())
        );
    }

    #[test]
    fn a_menu_command_with_no_windows_has_no_target() {
        assert_eq!(select_menu_target(None, &[]), None);
        assert_eq!(select_menu_target(Some("main"), &[]), None);
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
        // New Window is dispatched separately; it must not be mistaken for a
        // geometry-recovery command (which would silently recenter instead).
        assert_eq!(recovery_command_for_menu_id(NEW_WINDOW_MENU_ID), None);
    }

    // ---- labels -----------------------------------------------------------

    #[test]
    fn generated_labels_are_uuid_shaped_and_unique() {
        let mut seen = HashSet::new();
        for _ in 0..1_000 {
            let label = new_window_label();
            let uuid = label
                .strip_prefix("w-")
                .expect("labels are prefixed so they can't collide with configured labels");
            let groups: Vec<&str> = uuid.split('-').collect();
            assert_eq!(
                groups.iter().map(|group| group.len()).collect::<Vec<_>>(),
                vec![8, 4, 4, 4, 12],
                "not uuid shaped: {label}"
            );
            assert!(
                uuid.chars().all(|c| c.is_ascii_hexdigit() || c == '-'),
                "not hex: {label}"
            );
            assert!(seen.insert(label.clone()), "duplicate label {label}");
        }
    }

    #[test]
    fn a_taken_label_is_rerolled() {
        // A label already in use would hand the new window the live state of the
        // window that owns it.
        let checked = Cell::new(0);
        let label = allocate_window_label(|_| {
            checked.set(checked.get() + 1);
            checked.get() == 1
        });

        assert_eq!(checked.get(), 2, "the first (taken) label was accepted");
        assert!(label.starts_with("w-"));
    }

    #[test]
    fn an_always_taken_label_still_returns_a_window_label() {
        // Pathological (and impossible with 122 random bits), but the caller
        // needs a label to open a window with rather than an error.
        let attempts = Cell::new(0);
        let label = allocate_window_label(|_| {
            attempts.set(attempts.get() + 1);
            true
        });

        assert_eq!(attempts.get(), LABEL_ATTEMPTS);
        assert!(label.starts_with("w-"));
    }

    // ---- new-window config ------------------------------------------------

    fn configured_window() -> WindowConfig {
        WindowConfig {
            label: MAIN_WINDOW_LABEL.to_string(),
            title: "mdwriter".to_string(),
            width: 800.0,
            height: 600.0,
            min_width: Some(480.0),
            min_height: Some(360.0),
            center: true,
            visible: false,
            x: Some(10.0),
            y: Some(20.0),
            ..Default::default()
        }
    }

    #[test]
    fn a_new_window_clones_the_configured_window_with_a_new_label() {
        let config = new_window_config(Some(&configured_window()), "w-abc".to_string());

        assert_eq!(config.label, "w-abc");
        // Same window, only elsewhere: size and constraints come from
        // tauri.conf.json so a second window is not a different app.
        assert_eq!(config.width, 800.0);
        assert_eq!(config.height, 600.0);
        assert_eq!(config.min_width, Some(480.0));
        assert_eq!(config.title, "mdwriter");
    }

    #[test]
    fn a_new_window_is_not_centered_and_starts_visible() {
        let config = new_window_config(Some(&configured_window()), "w-abc".to_string());

        // S1.6: centering is exactly what stacks the new window on the old one.
        assert!(!config.center);
        // The configured position belongs to the first window; reusing it would
        // stack them just as precisely as centering.
        assert_eq!(config.x, None);
        assert_eq!(config.y, None);
        // The user asked for this window, so it shows even though the configured
        // window is created hidden.
        assert!(config.visible);
        assert!(config.focus);
    }

    #[test]
    fn a_new_window_falls_back_to_defaults_without_config() {
        let config = new_window_config(None, "w-abc".to_string());

        assert_eq!(config.label, "w-abc");
        assert!(!config.center);
        assert!(config.visible);
    }

    // ---- cascade position (S1.6) ------------------------------------------

    #[test]
    fn a_new_window_is_offset_from_the_window_it_was_opened_from() {
        let source = Rect::new(100, 100, 800, 600);
        let displays = [Display::new(Rect::new(0, 0, 1440, 900), 1.0)];

        let (x, y) = cascade_position(source, &displays);

        assert_eq!((x, y), (132, 132));
        assert_ne!((x, y), (source.x, source.y), "windows stacked exactly");
    }

    #[test]
    fn the_offset_scales_with_the_displays_density() {
        let source = Rect::new(100, 100, 1600, 1200);
        let displays = [Display::new(Rect::new(0, 0, 2880, 1800), 2.0)];

        // 32 logical px on a 2x display is 64 physical px, so the visible
        // offset matches what a 1x display gets.
        assert_eq!(cascade_position(source, &displays), (164, 164));
    }

    #[test]
    fn a_cascade_that_would_leave_the_display_wraps_back() {
        // A window already pushed to the bottom-right: one more step and the
        // new window would be effectively off-screen.
        let source = Rect::new(1370, 830, 800, 600);
        let displays = [Display::new(Rect::new(0, 0, 1440, 900), 1.0)];

        let (x, y) = cascade_position(source, &displays);

        assert_eq!((x, y), (32, 32));
        assert!(has_meaningful_monitor_overlap(
            Rect::new(x, y, source.width, source.height),
            &displays
        ));
    }

    #[test]
    fn a_cascade_wraps_within_the_windows_own_display() {
        // Two monitors side by side; the source window is on the right-hand one
        // and near its bottom-right corner. Wrapping must not teleport the new
        // window to the other screen.
        let displays = [
            Display::new(Rect::new(0, 0, 1440, 900), 1.0),
            Display::new(Rect::new(1440, 0, 1440, 900), 1.0),
        ];
        let source = Rect::new(2810, 830, 800, 600);

        assert_eq!(cascade_position(source, &displays), (1472, 32));
    }

    #[test]
    fn a_cascade_offsets_even_with_no_monitor_information() {
        // Some platforms refuse to enumerate monitors; an unvalidated offset is
        // still better than an exact stack.
        assert_eq!(cascade_position(Rect::new(10, 20, 800, 600), &[]), (42, 52));
    }

    #[test]
    fn a_cascade_never_overflows_an_extreme_position() {
        let source = Rect::new(i32::MAX, i32::MAX, 800, 600);
        let displays = [Display::new(Rect::new(0, 0, 1440, 900), 1.0)];

        // Wraps rather than panicking on overflow in debug builds.
        assert_eq!(cascade_position(source, &displays), (32, 32));
    }

    #[test]
    fn the_home_display_is_the_one_the_window_mostly_occupies() {
        let displays = [
            Display::new(Rect::new(0, 0, 1440, 900), 1.0),
            Display::new(Rect::new(1440, 0, 1440, 900), 2.0),
        ];
        // Straddling the seam, mostly on the right monitor.
        let straddling = Rect::new(1340, 100, 800, 600);

        assert_eq!(
            home_display(straddling, &displays).map(|display| display.scale_factor),
            Some(2.0)
        );
        // Wholly off every display: fall back to the first rather than nothing,
        // so the wrap has somewhere to go.
        assert_eq!(
            home_display(Rect::new(9_000, 9_000, 800, 600), &displays)
                .map(|display| display.work_area),
            Some(Rect::new(0, 0, 1440, 900))
        );
        assert!(home_display(Rect::new(0, 0, 800, 600), &[]).is_none());
    }

    // ---- destroy / cleanup (S3.1, S3.2) -----------------------------------

    /// A real watcher of the production type, so the drop under test is the drop
    /// that ships.
    fn watch(dir: &TempDir) -> Debouncer<RecommendedWatcher, FileIdMap> {
        let mut debouncer = new_debouncer(Duration::from_millis(150), None, |_result| {}).unwrap();
        debouncer
            .watcher()
            .watch(dir.path(), RecursiveMode::Recursive)
            .unwrap();
        debouncer
    }

    // ---- close: hide vs destroy (S3.1, S3.2, S3.4) ------------------------

    #[test]
    fn closing_a_window_while_others_are_open_destroys_it() {
        // The bug this pins: hiding instead of destroying means `Destroyed`
        // never fires, so nothing ever releases the closed window's watcher or
        // its vault claim. Destroy is the only action that runs teardown.
        assert_eq!(close_action(true, 2), CloseAction::Destroy);
        assert_eq!(close_action(false, 2), CloseAction::Destroy);
        assert_eq!(close_action(true, 7), CloseAction::Destroy);
    }

    #[test]
    fn only_the_last_window_on_macos_is_hidden_instead_of_destroyed() {
        // S3.4: a macOS app outlives its last window, and that window stays
        // reusable for Dock Reopen.
        assert_eq!(close_action(true, 1), CloseAction::Hide);
        // Everywhere else the last window closing is the app quitting.
        assert_eq!(close_action(false, 1), CloseAction::Destroy);
        // Racing closes can report zero live windows; on macOS that must not be
        // read as "there are others open".
        assert_eq!(close_action(true, 0), CloseAction::Hide);
        assert_eq!(close_action(false, 0), CloseAction::Destroy);
    }

    /// Minimal `*`-glob match — enough for the capability window patterns.
    fn matches_label(pattern: &str, label: &str) -> bool {
        match pattern.split_once('*') {
            None => pattern == label,
            Some((prefix, suffix)) => {
                label.len() >= prefix.len() + suffix.len()
                    && label.starts_with(prefix)
                    && label.ends_with(suffix)
            }
        }
    }

    #[test]
    fn the_default_capability_covers_runtime_window_labels() {
        // Capabilities are label-scoped, and the frontend's half of the close
        // path is a `core:event` listener: a capability that only names "main"
        // leaves every runtime window unable to register the close-requested
        // handler that calls `close_window` (and unable to hear `vault-changed`).
        #[derive(serde::Deserialize)]
        struct Capability {
            windows: Vec<String>,
        }

        let capability: Capability =
            serde_json::from_str(include_str!("../capabilities/default.json"))
                .expect("the default capability parses");
        let runtime_label = new_window_label();

        for label in [MAIN_WINDOW_LABEL, runtime_label.as_str()] {
            assert!(
                capability
                    .windows
                    .iter()
                    .any(|pattern| matches_label(pattern, label)),
                "no capability window pattern covers {label}: {:?}",
                capability.windows
            );
        }
    }

    #[test]
    fn destroying_a_window_releases_its_watcher() {
        // S3.2: closing a window must release that window's FSEvents
        // subscription, not park it in the map with no window left to drop it.
        let vault = tempdir().unwrap();
        let state = AppState::default();
        let observer = {
            let window = state.register("w-1");
            *window.watcher.lock().unwrap() = Some(watch(&vault));
            Arc::downgrade(&window)
        };

        release_window_state(&state, "w-1");

        assert!(
            observer.upgrade().is_none(),
            "the closed window's state (and its watcher) outlived it"
        );
        assert!(state.labels().is_empty());
    }

    #[test]
    fn destroying_one_window_leaves_the_others_watcher_running() {
        // S3.1: the canonical failure is tearing down the surviving window's
        // watcher along with the closed window's.
        let vault_a = tempdir().unwrap();
        let vault_b = tempdir().unwrap();
        let state = AppState::default();
        let a = state.register("w-a");
        a.set_active_vault(Some(vault_a.path().canonicalize().unwrap()));
        *a.watcher.lock().unwrap() = Some(watch(&vault_a));
        drop(a);
        let b = state.register("w-b");
        b.set_active_vault(Some(vault_b.path().canonicalize().unwrap()));
        *b.watcher.lock().unwrap() = Some(watch(&vault_b));
        drop(b);

        release_window_state(&state, "w-a");

        assert_eq!(state.labels(), vec!["w-b".to_string()]);
        let survivor = state.get("w-b").expect("window b is still open");
        assert!(
            survivor.watcher.lock().unwrap().is_some(),
            "the surviving window stopped watching its vault"
        );
        assert_eq!(
            survivor.active_vault_root().unwrap(),
            vault_b.path().canonicalize().unwrap()
        );
    }

    #[test]
    fn destroying_a_window_twice_is_harmless() {
        // Tauri can report a destroy for a window we never registered (and the
        // failed-open path releases the label itself before any event fires).
        let state = AppState::default();
        state.register("w-1");

        release_window_state(&state, "w-1");
        release_window_state(&state, "w-1");
        release_window_state(&state, "never-existed");

        assert!(state.labels().is_empty());
    }

    #[test]
    fn a_destroyed_window_stops_answering_the_duplicate_check() {
        // Closing the window that held a vault must free that vault: otherwise
        // the next open would be bounced to a window that no longer exists.
        let vault = tempdir().unwrap();
        let state = AppState::default();
        state
            .register("w-a")
            .set_active_vault(Some(vault.path().canonicalize().unwrap()));

        release_window_state(&state, "w-a");

        assert_eq!(other_window_with_vault(&state, "w-b", vault.path()), None);
    }

    // ---- focus instead of duplicate (S1.5) --------------------------------

    #[test]
    fn opening_a_vault_another_window_has_names_that_window() {
        let vault = tempdir().unwrap();
        let state = AppState::default();
        state
            .register("w-a")
            .set_active_vault(Some(vault.path().canonicalize().unwrap()));
        state.register("w-b");

        assert_eq!(
            other_window_with_vault(&state, "w-b", vault.path()),
            Some("w-a".to_string())
        );
    }

    #[test]
    fn reopening_the_vault_this_window_already_has_is_not_a_duplicate() {
        // Otherwise a window would be told to focus itself and abort the
        // reload, which is how "open the same folder again" would stop working.
        let vault = tempdir().unwrap();
        let state = AppState::default();
        state
            .register("w-a")
            .set_active_vault(Some(vault.path().canonicalize().unwrap()));

        assert_eq!(other_window_with_vault(&state, "w-a", vault.path()), None);
    }

    #[test]
    fn an_unopened_vault_is_not_a_duplicate() {
        let open = tempdir().unwrap();
        let other = tempdir().unwrap();
        let state = AppState::default();
        state
            .register("w-a")
            .set_active_vault(Some(open.path().canonicalize().unwrap()));

        assert_eq!(other_window_with_vault(&state, "w-b", other.path()), None);
    }
}
