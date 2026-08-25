import { getFrontmatterValues } from "../../lib/doc"
import { joinPath, parent } from "../../lib/paths"

/** The vault-wide stylesheet, applied to every document reading view. */
export const VAULT_STYLESHEET = "markdown.css"

/**
 * Return stylesheet paths in cascade order. A document may declare `css` as a
 * string or simple YAML list; its `.md.css` companion is always last so it can
 * make truly document-specific adjustments. Paths are deliberately resolved
 * only from the note's directory or the vault root. Rust's scoped read command
 * remains the final authority that prevents escaping the open vault.
 */
export function documentStylesheetPaths(
  text: string,
  documentPath: string,
  vaultRoot: string,
): string[] {
  const values = getFrontmatterValues(text)
  const declared = stylesheetReferences(values.css)
    .map((ref) => resolveCssReference(documentPath, ref))
    .filter((path): path is string => path !== null)

  return [...new Set([
    joinPath(vaultRoot, VAULT_STYLESHEET),
    ...declared,
    `${documentPath}.css`,
  ])]
}

function stylesheetReferences(value: unknown): string[] {
  const candidates = Array.isArray(value) ? value : [value]
  return candidates.filter((value): value is string =>
    typeof value === "string" && isRelativeCssPath(value),
  )
}

function isRelativeCssPath(value: string): boolean {
  const path = value.trim()
  // Absolute paths and URL schemes would make styling unexpectedly reach
  // beyond a vault. Relative `../shared.css` is fine: the backend canonicalizes
  // it and rejects it if it crosses the vault boundary.
  return Boolean(path)
    && /\.css$/i.test(path)
    && !/^[\\/]/.test(path)
    && !/^[a-z]:[\\/]/i.test(path)
    && !/^[a-z][a-z0-9+.-]*:/i.test(path)
}

function resolveCssReference(documentPath: string, reference: string): string | null {
  const normalized = reference.trim().replace(/\\/g, "/")
  if (!isRelativeCssPath(normalized)) return null
  return joinPath(parent(documentPath), normalized)
}
