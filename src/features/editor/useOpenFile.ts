import { useEffect } from "react"
import { ipc } from "../../lib/ipc"
import { useStore } from "../../lib/store"
import { findNode } from "../tree/findNode"
import { parseDoc } from "../../lib/doc"

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
        const text = await ipc.readFile(selectedPath)
        if (cancelled) return
        const parsed = parseDoc(text)
        setOpenDoc({
          path: selectedPath,
          text,
          frontmatter: parsed.values,
          rawMarkdown: parsed.body,
          blocks: null,
          dirty: false,
          savedAt: null,
          parseError: parsed.parseError,
        })
      } catch (e) {
        if (cancelled) return
        setOpenDoc({
          path: selectedPath,
          text: "",
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
