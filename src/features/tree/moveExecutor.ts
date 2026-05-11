import { ipc } from "../../lib/ipc"
import { useStore } from "../../lib/store"
import { basename, joinPath, parent } from "../../lib/paths"
import { noteSelfWrite } from "../watcher/useExternalChanges"
import { refreshTree } from "./useTreeActions"
import { requestCollision, type CollisionChoice } from "./dndPrompts"

export type MoveResult = {
  moved: number
  skipped: number
  cancelled: boolean
}

/**
 * Suggest a non-colliding name in `targetDir` by appending `-1`, `-2`, ...
 * before the extension. Pure (doesn't probe disk) — collision detection
 * still happens at the IPC layer via `rename_path`'s no-clobber semantics.
 */
function suggestRenameName(name: string): string {
  const dot = name.lastIndexOf(".")
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ""
  return `${stem}-1${ext}`
}

/**
 * Walk a candidate name through `-1`, `-2`, ... until rename_path
 * accepts it. Used by the "Rename" branch of the collision dialog.
 */
async function tryRenameWithSuffix(
  from: string,
  targetDir: string,
  startName: string,
): Promise<string | null> {
  const dot = startName.lastIndexOf(".")
  const stem = dot > 0 ? startName.slice(0, dot) : startName
  const ext = dot > 0 ? startName.slice(dot) : ""
  // startName already has "-1"; strip it back to the base stem and walk up.
  const baseStem = stem.replace(/-\d+$/, "")
  for (let n = 1; n <= 200; n++) {
    const candidate = joinPath(targetDir, `${baseStem}-${n}${ext}`)
    if (candidate === from) return null
    try {
      noteSelfWrite(from)
      noteSelfWrite(candidate)
      await ipc.renamePath(from, candidate)
      return candidate
    } catch {
      // Collision on this suffix — try the next.
    }
  }
  return null
}

/**
 * Move (rename to a different folder) a list of source paths into
 * `targetDir`. On collision, prompts the user via the collision dialog.
 *
 * Returns counts so callers can show a summary toast.
 */
export async function moveItems(
  sourcePaths: string[],
  targetDir: string,
): Promise<MoveResult> {
  let moved = 0
  let skipped = 0
  let applyToRest: { choice: CollisionChoice } | null = null

  for (let i = 0; i < sourcePaths.length; i++) {
    const from = sourcePaths[i]
    const name = basename(from)
    const to = joinPath(targetDir, name)

    if (parent(from) === targetDir) {
      // Already there — count as a no-op skip silently.
      continue
    }

    // First attempt: straight rename.
    try {
      noteSelfWrite(from)
      noteSelfWrite(to)
      await ipc.renamePath(from, to)
      await onMoved(from, to)
      moved++
      continue
    } catch (err) {
      // Inspect error: rename_path returns AppError::Io("destination exists: …") on collision.
      const msg = String(err)
      if (!msg.includes("destination exists")) {
        console.error("move failed", from, "→", to, err)
        skipped++
        continue
      }
    }

    // Collision — consult user (or use sticky choice).
    let choice: CollisionChoice
    if (applyToRest) {
      choice = applyToRest.choice
    } else {
      const remaining = sourcePaths.length - i - 1
      const decision = await requestCollision({
        name,
        targetDir,
        suggestedRename: suggestRenameName(name),
        remaining,
      })
      if (decision.applyToRest) applyToRest = { choice: decision.choice }
      choice = decision.choice
    }
    if (choice === "cancel") {
      return { moved, skipped, cancelled: true }
    }
    if (choice === "skip") {
      skipped++
      continue
    }
    // Rename branch — try -1, -2, ...
    const renamed = await tryRenameWithSuffix(from, targetDir, suggestRenameName(name))
    if (renamed) {
      await onMoved(from, renamed)
      moved++
    } else {
      skipped++
    }
  }

  await refreshTree()
  return { moved, skipped, cancelled: false }
}

/**
 * Remap a path that was rooted under `fromRoot` to be rooted under
 * `toRoot` instead. Returns null if the path isn't a descendant or
 * exact match of fromRoot.
 */
function remapPath(path: string, fromRoot: string, toRoot: string): string | null {
  if (path === fromRoot) return toRoot
  // Treat both `/` and `\` as separators since paths from Rust come
  // through unchanged on the relevant platforms.
  for (const sep of ["/", "\\"]) {
    const prefix = fromRoot + sep
    if (path.startsWith(prefix)) return toRoot + sep + path.slice(prefix.length)
  }
  return null
}

/**
 * Update store state after a successful single-item move so the editor
 * follows the file and the selection points at the new path. Handles
 * folder moves by remapping any path that lives under the moved root.
 */
async function onMoved(from: string, to: string): Promise<void> {
  const s = useStore.getState()
  const patch: Partial<{
    selectedPath: string | null
    selectedPaths: Set<string>
    openDoc: typeof s.openDoc
    expandedFolders: Set<string>
  }> = {}

  const remappedSel = s.selectedPath ? remapPath(s.selectedPath, from, to) : null
  if (remappedSel) patch.selectedPath = remappedSel

  let pathsChanged = false
  const nextPaths = new Set<string>()
  for (const p of s.selectedPaths) {
    const r = remapPath(p, from, to)
    if (r) {
      nextPaths.add(r)
      pathsChanged = true
    } else {
      nextPaths.add(p)
    }
  }
  if (pathsChanged) patch.selectedPaths = nextPaths

  if (s.openDoc) {
    const r = remapPath(s.openDoc.path, from, to)
    if (r) patch.openDoc = { ...s.openDoc, path: r }
  }

  let expChanged = false
  const nextExp = new Set<string>()
  for (const p of s.expandedFolders) {
    const r = remapPath(p, from, to)
    if (r) {
      nextExp.add(r)
      expChanged = true
    } else {
      nextExp.add(p)
    }
  }
  if (expChanged) patch.expandedFolders = nextExp

  if (Object.keys(patch).length > 0) useStore.setState(patch)
}
