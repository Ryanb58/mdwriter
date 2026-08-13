import { emit, emitTo, listen, type EventCallback, type UnlistenFn } from "@tauri-apps/api/event"
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow"

/**
 * Per-window event subscription.
 *
 * The Rust side addresses window-scoped events (`vault-changed`, the menu
 * bridges) with `emit_to(label, ...)` instead of broadcasting, so that window
 * A's file watcher can't refresh window B's tree. That only works if the
 * receiver opts in: a bare `listen()` registers `EventTarget::Any`, and Tauri
 * delivers to `Any` listeners regardless of the emit target (see
 * `match_any_or_filter` in tauri's `event/listener.rs`). Registering against
 * this window's label is what makes the address stick.
 *
 * Use this — not `listen` — for anything a single window should react to.
 * Genuinely app-wide events (none today) may use `listen` directly.
 */
export function listenForThisWindow<T>(
  event: string,
  handler: EventCallback<T>,
): Promise<UnlistenFn> {
  const label = currentWindowLabel()
  if (label === null) {
    // Browser-only dev/test (`pnpm dev`, vitest): there is no Tauri window to
    // scope to. Fall back to an unscoped listener so the hook still behaves.
    return listen<T>(event, handler)
  }
  return listen<T>(event, handler, { target: { kind: "WebviewWindow", label } })
}

/** Send an event to this window alone. */
export function emitToThisWindow(event: string, payload?: unknown): Promise<void> {
  const label = currentWindowLabel()
  if (label === null) return Promise.resolve()
  return emitTo({ kind: "WebviewWindow", label }, event, payload)
}

/**
 * Broadcast to every window, including this one.
 *
 * The deliberate opposite of `emitToThisWindow`: use it only for genuinely
 * app-wide facts (an app-global preference was written), and have receivers
 * ignore their own `origin` rather than trying to exclude the sender here —
 * Tauri has no "all but me" target.
 */
export function emitToAllWindows(event: string, payload?: unknown): Promise<void> {
  return emit(event, payload)
}

/**
 * Subscribe to an app-wide broadcast. Unlike `listenForThisWindow` this
 * registers `EventTarget::Any` on purpose, so it receives `emit` from any
 * window. Only correct for events every window must react to.
 */
export function listenToAllWindows<T>(
  event: string,
  handler: EventCallback<T>,
): Promise<UnlistenFn> {
  return listen<T>(event, handler)
}

/**
 * Label this window namespaces its per-window persisted entries under. Read
 * once: a webview's label never changes. Outside the desktop shell (`pnpm dev`,
 * vitest) there is no label, and "main" keeps browser-only runs pointed at the
 * same entries the primary window uses.
 *
 * It lives here rather than in the store because state kept *outside* the store
 * (the layout panels) has to scope itself by the same label.
 */
export const PERSIST_WINDOW_LABEL = currentWindowLabel() ?? "main"

/** Tauri label of the window running this webview, or null outside the desktop shell. */
export function currentWindowLabel(): string | null {
  try {
    return getCurrentWebviewWindow().label
  } catch {
    // Reading the label touches `__TAURI_INTERNALS__`, which is absent outside
    // the desktop shell.
    return null
  }
}
