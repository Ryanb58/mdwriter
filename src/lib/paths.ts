export function basename(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? ""
}

export function parent(p: string): string {
  const idx = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"))
  return idx <= 0 ? "" : p.slice(0, idx)
}

export function joinPath(a: string, b: string): string {
  const sep = a.includes("\\") ? "\\" : "/"
  return a.endsWith(sep) ? a + b : a + sep + b
}

export function isMarkdown(p: string): boolean {
  return /\.(md|markdown)$/i.test(p)
}

// Returns `path` relative to `root`. If `path` does not live under `root`
// (or equals it without a separator before the rest), returns `path`
// unchanged so callers can fall back to the absolute path.
export function relativeTo(root: string, path: string): string {
  const sep = root.includes("\\") ? "\\" : "/"
  const r = root.endsWith(sep) ? root.slice(0, -1) : root
  if (path === r) return ""
  const prefix = r + sep
  if (path.startsWith(prefix)) return path.slice(prefix.length)
  return path
}
