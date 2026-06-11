/**
 * Tiny module-level toast pub/sub — no dependency, no store coupling, so
 * non-React code (save loop, paste pipelines) can surface errors without
 * threading callbacks. `<Toasts />` subscribes and renders the stack.
 */

export type ToastKind = "error" | "info"

export type Toast = {
  id: number
  message: string
  kind: ToastKind
}

const DEFAULT_DURATION_MS = 4000

let nextId = 1
let toasts: Toast[] = []
const listeners = new Set<(toasts: Toast[]) => void>()

function emit() {
  for (const cb of listeners) cb(toasts)
}

/**
 * Show a toast. Auto-dismisses after `duration` ms (default 4s). Returns
 * the toast id so callers can dismiss early.
 */
export function showToast(
  message: string,
  opts?: { kind?: ToastKind; duration?: number },
): number {
  const id = nextId++
  toasts = [...toasts, { id, message, kind: opts?.kind ?? "info" }]
  emit()
  setTimeout(() => dismissToast(id), opts?.duration ?? DEFAULT_DURATION_MS)
  return id
}

/** Remove a toast by id. No-op when it already auto-dismissed. */
export function dismissToast(id: number): void {
  if (!toasts.some((t) => t.id === id)) return
  toasts = toasts.filter((t) => t.id !== id)
  emit()
}

/**
 * Subscribe to the toast list. The callback fires immediately with the
 * current list and on every change. Returns an unsubscribe function.
 */
export function subscribeToasts(cb: (toasts: Toast[]) => void): () => void {
  listeners.add(cb)
  cb(toasts)
  return () => {
    listeners.delete(cb)
  }
}

/** Drop every toast. Exposed for tests. */
export function clearToasts(): void {
  if (toasts.length === 0) return
  toasts = []
  emit()
}

/** Short, human-readable message from a caught error value. */
export function errorText(e: unknown): string {
  const s = e instanceof Error ? e.message : String(e)
  return s.length > 140 ? s.slice(0, 139) + "…" : s
}
