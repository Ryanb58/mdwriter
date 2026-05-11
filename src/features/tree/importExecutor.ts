import { ipc } from "../../lib/ipc"
import { basename, joinPath } from "../../lib/paths"
import { noteSelfWrite } from "../watcher/useExternalChanges"
import { refreshTree } from "./useTreeActions"
import { requestCollision, requestConfirm, type CollisionChoice } from "./dndPrompts"

const MARKDOWN_EXTS = ["md", "markdown"]
const IMAGE_EXTS = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif"]

export type ImportClassification = {
  accepted: File[]
  skipped: Array<{ name: string; reason: string }>
}

// Tauri serializes command errors as `{ kind, message }` — String(err)
// would yield `"[object Object]"`, hiding the collision case. The Rust
// `import_file` command surfaces collisions as `already exists: <path>`.
function isAlreadyExistsError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false
  const msg = (e as { message?: unknown }).message
  return typeof msg === "string" && msg.startsWith("already exists:")
}

function extOf(name: string): string {
  const dot = name.lastIndexOf(".")
  return dot < 0 ? "" : name.slice(dot + 1).toLowerCase()
}

/**
 * Filter dropped files to markdown + image types. Anything else is
 * reported as skipped so the import-confirm modal can show the user
 * what won't be brought in.
 */
export function classifyImports(files: FileList | File[]): ImportClassification {
  const accepted: File[] = []
  const skipped: Array<{ name: string; reason: string }> = []
  for (const f of Array.from(files)) {
    const ext = extOf(f.name)
    if (MARKDOWN_EXTS.includes(ext) || IMAGE_EXTS.includes(ext)) {
      accepted.push(f)
    } else {
      skipped.push({ name: f.name, reason: ext ? `unsupported (.${ext})` : "no extension" })
    }
  }
  return { accepted, skipped }
}

async function readBytes(file: File): Promise<Uint8Array> {
  const buf = await file.arrayBuffer()
  return new Uint8Array(buf)
}

function suggestRenameName(name: string): string {
  const dot = name.lastIndexOf(".")
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ""
  return `${stem}-1${ext}`
}

async function tryImportWithSuffix(
  bytes: Uint8Array,
  targetDir: string,
  startName: string,
): Promise<string | null> {
  const dot = startName.lastIndexOf(".")
  const stem = dot > 0 ? startName.slice(0, dot) : startName
  const ext = dot > 0 ? startName.slice(dot) : ""
  const baseStem = stem.replace(/-\d+$/, "")
  for (let n = 1; n <= 200; n++) {
    const candidate = joinPath(targetDir, `${baseStem}-${n}${ext}`)
    try {
      noteSelfWrite(candidate)
      await ipc.importFile(candidate, bytes)
      return candidate
    } catch (err) {
      if (!isAlreadyExistsError(err)) throw err
      // Try the next suffix.
    }
  }
  return null
}

export type ImportResult = {
  imported: number
  skipped: number
  cancelled: boolean
}

/**
 * Copy a set of dropped files into `targetDir`. Shows a confirmation
 * modal listing the files (and any skipped types) before any I/O.
 * Reuses the shared collision dialog for name conflicts.
 */
export async function importDroppedFiles(
  files: FileList | File[],
  targetDir: string,
): Promise<ImportResult> {
  const { accepted, skipped } = classifyImports(files)
  if (accepted.length === 0) {
    if (skipped.length > 0) {
      await requestConfirm({
        title: "Nothing to import",
        message: `mdwriter only imports markdown and image files. None of the dropped files match.`,
        confirmLabel: "OK",
        cancelLabel: "Dismiss",
        details: skipped.map((s) => `${s.name} — ${s.reason}`),
      })
    }
    return { imported: 0, skipped: skipped.length, cancelled: false }
  }

  const message = `Copy ${accepted.length} file${accepted.length === 1 ? "" : "s"} into the vault?`
  const ok = await requestConfirm({
    title: `Import into ${basename(targetDir) || targetDir}`,
    message,
    confirmLabel: "Import",
    cancelLabel: "Cancel",
    details: [
      ...accepted.map((f) => f.name),
      ...skipped.map((s) => `(skipped) ${s.name} — ${s.reason}`),
    ],
  })
  if (!ok) return { imported: 0, skipped: skipped.length, cancelled: true }

  let imported = 0
  let skipCount = skipped.length
  let applyToRest: { choice: CollisionChoice } | null = null

  for (let i = 0; i < accepted.length; i++) {
    const file = accepted[i]
    const target = joinPath(targetDir, file.name)
    const bytes = await readBytes(file)

    try {
      noteSelfWrite(target)
      await ipc.importFile(target, bytes)
      imported++
      continue
    } catch (err) {
      if (!isAlreadyExistsError(err)) {
        console.error("import failed", file.name, err)
        skipCount++
        continue
      }
    }

    let choice: CollisionChoice
    if (applyToRest) {
      choice = applyToRest.choice
    } else {
      const remaining = accepted.length - i - 1
      const decision = await requestCollision({
        name: file.name,
        targetDir,
        suggestedRename: suggestRenameName(file.name),
        remaining,
      })
      if (decision.applyToRest) applyToRest = { choice: decision.choice }
      choice = decision.choice
    }

    if (choice === "cancel") {
      await refreshTree()
      return { imported, skipped: skipCount, cancelled: true }
    }
    if (choice === "skip") {
      skipCount++
      continue
    }
    try {
      const renamed = await tryImportWithSuffix(bytes, targetDir, suggestRenameName(file.name))
      if (renamed) imported++
      else skipCount++
    } catch (err) {
      console.error("import-with-suffix failed", file.name, err)
      skipCount++
    }
  }

  await refreshTree()
  return { imported, skipped: skipCount, cancelled: false }
}
