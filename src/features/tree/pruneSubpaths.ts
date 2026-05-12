/**
 * From a set of paths, remove any path that's a strict descendant of
 * another path in the set. Used before bulk-trashing so we don't try
 * to trash a child after its parent directory has already been moved.
 *
 * Handles both `/` and `\` separators so behavior matches the rest of
 * the path helpers.
 */
export function pruneSubpaths(paths: Iterable<string>): string[] {
  const unique = Array.from(new Set(paths))
  unique.sort((a, b) => a.length - b.length)
  const kept: string[] = []
  for (const p of unique) {
    if (!kept.some((k) => p.startsWith(k + "/") || p.startsWith(k + "\\"))) {
      kept.push(p)
    }
  }
  return kept
}

/**
 * True if `path` equals any of `roots`, or sits underneath one of them
 * (treating both `/` and `\` as separators).
 */
export function isUnderAny(path: string, roots: readonly string[]): boolean {
  for (const r of roots) {
    if (path === r) return true
    if (path.startsWith(r + "/") || path.startsWith(r + "\\")) return true
  }
  return false
}
