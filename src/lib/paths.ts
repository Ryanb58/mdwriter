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
