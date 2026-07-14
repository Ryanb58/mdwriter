import { useStore, type AppStore } from "./store"

/** True when path is root itself or a descendant separated by `/` or `\\`. */
export function pathIsWithin(path: string, root: string): boolean {
  if (path === root) return true
  if (root.endsWith("/") || root.endsWith("\\")) return path.startsWith(root)
  return path.startsWith(`${root}/`) || path.startsWith(`${root}\\`)
}

function remapPath(path: string, from: string, to: string): string | null {
  if (path === from) return to
  for (const separator of ["/", "\\"]) {
    const prefix = from.endsWith(separator) ? from : `${from}${separator}`
    if (path.startsWith(prefix)) {
      const targetPrefix = to.endsWith(separator) ? to : `${to}${separator}`
      return `${targetPrefix}${path.slice(prefix.length)}`
    }
  }
  return null
}

function remapOptional(path: string | null, from: string, to: string): string | null {
  return path ? remapPath(path, from, to) ?? path : null
}

function remapSet(paths: ReadonlySet<string>, from: string, to: string): Set<string> {
  return new Set([...paths].map((path) => remapPath(path, from, to) ?? path))
}

function remapArray(paths: readonly string[], from: string, to: string): string[] {
  return [...new Set(paths.map((path) => remapPath(path, from, to) ?? path))]
}

function remapRecord(
  values: Record<string, string>,
  from: string,
  to: string,
): Record<string, string> {
  const next: Record<string, string> = {}
  for (const [path, value] of Object.entries(values)) {
    next[remapPath(path, from, to) ?? path] = value
  }
  return next
}

/**
 * Atomically follow a successful filesystem rename across every live path-
 * keyed editor state value. The save coordinator is remapped separately by
 * the mutation guard because it owns in-flight snapshots outside Zustand.
 */
export function remapOpenDocumentPath(from: string, to: string): void {
  useStore.setState((state) => {
    const recentFilesByVault = Object.fromEntries(
      Object.entries(state.recentFilesByVault).map(([vault, paths]) => [
        vault,
        remapArray(paths, from, to),
      ]),
    )

    return {
      openDoc: state.openDoc
        ? {
            ...state.openDoc,
            path: remapPath(state.openDoc.path, from, to) ?? state.openDoc.path,
          }
        : null,
      selectedPath: remapOptional(state.selectedPath, from, to),
      selectedPaths: remapSet(state.selectedPaths, from, to),
      expandedFolders: remapSet(state.expandedFolders, from, to),
      pinnedPaths: remapArray(state.pinnedPaths, from, to),
      blockModeOverrides: remapRecord(state.blockModeOverrides, from, to),
      pendingScroll: state.pendingScroll
        ? {
            ...state.pendingScroll,
            path: remapPath(state.pendingScroll.path, from, to) ?? state.pendingScroll.path,
          }
        : null,
      blockTextIndex: state.blockTextIndex
        ? {
            ...state.blockTextIndex,
            path: remapPath(state.blockTextIndex.path, from, to)
              ?? state.blockTextIndex.path,
          }
        : null,
      pendingCursorAtEnd: remapOptional(state.pendingCursorAtEnd, from, to),
      headingCommittedPath: remapOptional(state.headingCommittedPath, from, to),
      editorSelection: state.editorSelection
        ? {
            ...state.editorSelection,
            sourcePath: remapOptional(state.editorSelection.sourcePath, from, to),
          }
        : null,
      loadError: state.loadError
        ? {
            ...state.loadError,
            path: remapPath(state.loadError.path, from, to) ?? state.loadError.path,
          }
        : null,
      renamingPath: remapOptional(state.renamingPath, from, to),
      recentFilesByVault,
    } satisfies Partial<AppStore>
  })
}

/** Atomically clear live path-keyed state beneath successfully removed roots. */
export function removeOpenDocumentPaths(roots: readonly string[]): void {
  if (roots.length === 0) return
  const removed = (path: string | null): boolean =>
    Boolean(path && roots.some((root) => pathIsWithin(path, root)))

  useStore.setState((state) => {
    const recentFilesByVault = Object.fromEntries(
      Object.entries(state.recentFilesByVault).map(([vault, paths]) => [
        vault,
        paths.filter((path) => !removed(path)),
      ]),
    )

    const blockModeOverrides = Object.fromEntries(
      Object.entries(state.blockModeOverrides).filter(([path]) => !removed(path)),
    )

    return {
      openDoc: state.openDoc && removed(state.openDoc.path) ? null : state.openDoc,
      selectedPath: removed(state.selectedPath) ? null : state.selectedPath,
      selectedPaths: new Set([...state.selectedPaths].filter((path) => !removed(path))),
      expandedFolders: new Set([...state.expandedFolders].filter((path) => !removed(path))),
      pinnedPaths: state.pinnedPaths.filter((path) => !removed(path)),
      blockModeOverrides,
      pendingScroll: state.pendingScroll && removed(state.pendingScroll.path)
        ? null
        : state.pendingScroll,
      blockTextIndex: state.blockTextIndex && removed(state.blockTextIndex.path)
        ? null
        : state.blockTextIndex,
      pendingCursorAtEnd: removed(state.pendingCursorAtEnd) ? null : state.pendingCursorAtEnd,
      headingCommittedPath: removed(state.headingCommittedPath) ? null : state.headingCommittedPath,
      editorSelection: state.editorSelection && removed(state.editorSelection.sourcePath)
        ? null
        : state.editorSelection,
      loadError: state.loadError && removed(state.loadError.path) ? null : state.loadError,
      renamingPath: removed(state.renamingPath) ? null : state.renamingPath,
      recentFilesByVault,
    } satisfies Partial<AppStore>
  })
}
