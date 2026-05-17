import { parent } from "../../lib/paths"

export function stringField(input: Record<string, unknown>, key: string): string | undefined {
  const v = input[key]
  return typeof v === "string" ? v : undefined
}

export function numberField(input: Record<string, unknown>, key: string): number | undefined {
  const v = input[key]
  return typeof v === "number" ? v : undefined
}

export function getToolPath(input: Record<string, unknown>): string | undefined {
  return stringField(input, "file_path") ?? stringField(input, "path")
}

export function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s
}

/**
 * Path prefix used when the user picks "Allow for session" on a
 * path-shaped tool input. The broker matches with `starts_with` against
 * `file_path`/`path` on the Rust side; trailing slash is preserved so a
 * directory rule doesn't accidentally match a sibling whose name starts
 * with the same characters.
 */
export function pathPrefixForAllowlist(filePath: string): string {
  const p = parent(filePath)
  if (!p) return filePath
  const sep = filePath.includes("\\") && !filePath.includes("/") ? "\\" : "/"
  return p.endsWith(sep) ? p : p + sep
}
