import { basename, joinPath } from "../../lib/paths"

export type BreadcrumbFolder = { name: string; path: string }

export type BreadcrumbTrail = {
  vaultName: string
  folders: BreadcrumbFolder[]
  fileName: string
}

/**
 * Decompose the open doc's path into the parts the breadcrumb renders:
 * the vault label, each subfolder segment (with the absolute path we can
 * use to reveal it in the tree), and the file name.
 *
 * Returns `folders: []` when `docPath` lives outside `rootPath` — we
 * still render the trail as text, but there's nothing meaningful to
 * click because the segments wouldn't resolve to tree rows.
 */
export function buildBreadcrumbTrail(
  rootPath: string | null,
  docPath: string,
): BreadcrumbTrail {
  const root = rootPath ?? ""
  const insideVault = !!root && docPath.startsWith(root)
  const rel = insideVault
    ? docPath.slice(root.length).replace(/^[\\/]+/, "")
    : docPath
  const segments = rel.split(/[\\/]/).filter(Boolean)
  const fileName = segments.pop() ?? basename(docPath)
  const vaultName = root ? basename(root) : ""

  const folders: BreadcrumbFolder[] = insideVault
    ? segments.reduce<BreadcrumbFolder[]>((acc, name) => {
        const prev = acc.length ? acc[acc.length - 1].path : root
        acc.push({ name, path: joinPath(prev, name) })
        return acc
      }, [])
    : []

  return { vaultName, folders, fileName }
}
