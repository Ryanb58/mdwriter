import { ipc } from "../../lib/ipc"
import { basename, joinPath, parent } from "../../lib/paths"
import { beginOpenDocPathMutation } from "../../lib/writeDoc"
import { remapOpenDocumentPath } from "../../lib/openDocumentPaths"
import { noteSelfWrite } from "../watcher/useExternalChanges"
import { refreshDirectories } from "./treeLoader"
import { requestCollision, type CollisionChoice } from "./dndPrompts"
import { pruneSubpaths } from "./pruneSubpaths"

export type MoveResult = {
  moved: number
  skipped: number
  cancelled: boolean
}

// Tauri serializes command errors as `{ kind, message }`. Sniffing
// `String(err)` would yield `"[object Object]"`, so collision detection
// has to read `err.message` directly.
function isDestinationExistsError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false
  const msg = (e as { message?: unknown }).message
  return typeof msg === "string" && msg.startsWith("destination exists:")
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
    } catch (err) {
      if (!isDestinationExistsError(err)) throw err
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
  const sources = pruneSubpaths(sourcePaths)
    .filter((source) => parent(source) !== targetDir)
  let moved = 0
  let skipped = 0
  let applyToRest: { choice: CollisionChoice } | null = null

  if (sources.length === 0) {
    return { moved, skipped, cancelled: false }
  }
  const affectedDirectories = [...new Set([...sources.map(parent), targetDir])]

  const guard = await beginOpenDocPathMutation(sources)
  try {
    for (let i = 0; i < sources.length; i++) {
      const from = sources[i]
      const name = basename(from)
      const to = joinPath(targetDir, name)

      // First attempt: straight rename.
      try {
        noteSelfWrite(from)
        noteSelfWrite(to)
        await ipc.renamePath(from, to)
      } catch (err) {
        if (!isDestinationExistsError(err)) {
          console.error("move failed", from, "→", to, err)
          skipped++
          continue
        }

        // Collision — consult user (or use sticky choice).
        let choice: CollisionChoice
        if (applyToRest) {
          choice = applyToRest.choice
        } else {
          const remaining = sources.length - i - 1
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
          await refreshDirectories(affectedDirectories)
          return { moved, skipped, cancelled: true }
        }
        if (choice === "skip") {
          skipped++
          continue
        }

        // Rename branch — try -1, -2, ... and remap to the actual suffix.
        try {
          const renamed = await tryRenameWithSuffix(from, targetDir, suggestRenameName(name))
          if (renamed) {
            guard.remap(from, renamed)
            remapOpenDocumentPath(from, renamed)
            moved++
          } else {
            skipped++
          }
        } catch (renameError) {
          console.error("rename-with-suffix failed", from, renameError)
          skipped++
        }
        continue
      }

      guard.remap(from, to)
      remapOpenDocumentPath(from, to)
      moved++
    }

    await refreshDirectories(affectedDirectories)
    return { moved, skipped, cancelled: false }
  } finally {
    guard.release()
  }
}
