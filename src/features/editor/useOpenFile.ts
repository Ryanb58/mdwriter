import { useEffect } from "react"
import { ipc } from "../../lib/ipc"
import { useStore } from "../../lib/store"
import { findNode } from "../tree/findNode"
import { basename } from "../../lib/paths"

const UNTITLED_PATTERN = /^untitled(\s+\d+)?\.(md|markdown)$/i

export function useOpenFile() {
  const selectedPath = useStore((s) => s.selectedPath)
  const setOpenDoc = useStore((s) => s.setOpenDoc)

  useEffect(() => {
    if (!selectedPath) { setOpenDoc(null); return }
    // If the selected row is a directory, leave the current openDoc alone —
    // tree selection (highlight) is independent of which file is open.
    const node = findNode(useStore.getState().tree, selectedPath)
    if (node?.kind === "dir") return
    // Skip non-markdown paths: covers phantom tree entries (folder not yet
    // reflected) and visible non-markdown file nodes (PDFs, images, etc.).
    if (!/\.(md|markdown)$/i.test(selectedPath)) return
    let cancelled = false
    ;(async () => {
      try {
        const parsed = await ipc.readFile(selectedPath)
        if (cancelled) return
        const fm = (parsed.frontmatter && typeof parsed.frontmatter === "object" && !Array.isArray(parsed.frontmatter))
          ? parsed.frontmatter as Record<string, unknown>
          : {}
        const settings = useStore.getState().settings
        const seedH1 =
          settings.autoRenameFromH1 &&
          UNTITLED_PATTERN.test(basename(selectedPath)) &&
          !parsed.body.trim()
        console.log("[useOpenFile]", { path: selectedPath, body: JSON.stringify(parsed.body), seedH1, autoRenameFromH1: settings.autoRenameFromH1 })
        setOpenDoc({
          path: selectedPath,
          frontmatter: fm,
          rawMarkdown: seedH1 ? "# \n" : parsed.body,
          blocks: null,
          dirty: seedH1,
          savedAt: null,
          parseError: null,
        })
      } catch (e) {
        if (cancelled) return
        setOpenDoc({
          path: selectedPath,
          frontmatter: {},
          rawMarkdown: "",
          blocks: null,
          dirty: false,
          savedAt: null,
          parseError: String(e),
        })
      }
    })()
    return () => { cancelled = true }
  }, [selectedPath, setOpenDoc])
}
