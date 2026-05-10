export function debounce<Args extends unknown[]>(
  fn: (...args: Args) => void,
  wait: number,
): { call: (...args: Args) => void; flush: () => void; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null
  let pendingArgs: Args | null = null

  function call(...args: Args) {
    pendingArgs = args
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      const a = pendingArgs!
      pendingArgs = null
      fn(...a)
    }, wait)
  }
  function flush() {
    if (!timer) return
    clearTimeout(timer)
    timer = null
    if (pendingArgs) {
      const a = pendingArgs
      pendingArgs = null
      fn(...a)
    }
  }
  function cancel() {
    if (timer) clearTimeout(timer)
    timer = null
    pendingArgs = null
  }
  return { call, flush, cancel }
}
