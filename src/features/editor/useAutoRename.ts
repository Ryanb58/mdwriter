import { useEffect, useRef } from "react"
import { ipc } from "../../lib/ipc"
import { useStore } from "../../lib/store"
import { basename, parent, joinPath } from "../../lib/paths"
import { refreshTree } from "../tree/useTreeActions"
import { noteSelfWrite } from "../watcher/useExternalChanges"

const UNTITLED_PATTERN = /^untitled(\s+\d+)?\.(md|markdown)$/i

function extractFirstH1(markdown: string): string | null {
  // Strip leading frontmatter block first so a YAML key starting with "#" can't trip us up.
  const stripped = markdown.replace(/^---\n[\s\S]*?\n---\n?/, "")
  const m = stripped.match(/^#\s+(.+?)\s*$/m)
  return m ? m[1].trim() : null
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip combining accents
    .replace(/[^a-z0-9\s-]+/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
}

/**
 * After an auto-save settles on an "untitled*.md" file, if the body has a first
 * H1, rename the file to a slugified version of that heading.
 *
 * Only runs when settings.autoRenameFromH1 is on.
 */
export function useAutoRename() {
  const doc = useStore((s) => s.openDoc)
  const settings = useStore((s) => s.settings)
  // Tracks files we've already renamed away from so we don't loop.
  const renamedFrom = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!settings.autoRenameFromH1) return
    if (!doc) return
    if (doc.dirty) return                  // wait for the save to settle
    if (!doc.savedAt) return               // never saved → not eligible
    const name = basename(doc.path)
    if (!UNTITLED_PATTERN.test(name)) return
    if (renamedFrom.current.has(doc.path)) return

    const h1 = extractFirstH1(doc.rawMarkdown)
    if (!h1) return

    const slug = slugify(h1)
    if (!slug) return

    const parentDir = parent(doc.path)
    const fromPath = doc.path
    renamedFrom.current.add(fromPath)

    ;(async () => {
      // Find a non-colliding path; rename_path errors on collision, so loop.
      for (let n = 1; n <= 200; n++) {
        const target = joinPath(parentDir, n === 1 ? `${slug}.md` : `${slug}-${n}.md`)
        if (target === fromPath) return
        try {
          noteSelfWrite(target)
          noteSelfWrite(fromPath)
          await ipc.renamePath(fromPath, target)
          await refreshTree()
          // Update editor state to point at the renamed path.
          useStore.setState((s) => {
            const nextPaths = new Set(s.selectedPaths)
            if (nextPaths.has(fromPath)) {
              nextPaths.delete(fromPath)
              nextPaths.add(target)
            } else {
              nextPaths.add(target)
            }
            return {
              selectedPath: target,
              selectedPaths: nextPaths,
              openDoc: s.openDoc && s.openDoc.path === fromPath
                ? { ...s.openDoc, path: target }
                : s.openDoc,
            }
          })
          return
        } catch {
          // Collision — try the next suffix.
        }
      }
    })().catch((e) => console.error("auto-rename failed", e))
  }, [doc?.path, doc?.dirty, doc?.savedAt, doc?.rawMarkdown, settings.autoRenameFromH1])
}
