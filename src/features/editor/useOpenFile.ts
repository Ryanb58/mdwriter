import { useEffect } from "react"
import { ipc } from "../../lib/ipc"
import { useStore } from "../../lib/store"
import { findNode } from "../tree/findNode"

export function useOpenFile() {
  const selectedPath = useStore((s) => s.selectedPath)
  const setOpenDoc = useStore((s) => s.setOpenDoc)

  useEffect(() => {
    if (!selectedPath) { setOpenDoc(null); return }
    // If the selected row is a directory, leave the current openDoc alone —
    // tree selection (highlight) is independent of which file is open.
    const node = findNode(useStore.getState().tree, selectedPath)
    if (node?.kind === "dir") return
    // If the path isn't in the tree and doesn't look like a markdown file
    // (e.g. a folder whose tree entry isn't reflected yet), skip the read.
    if (!node && !/\.(md|markdown)$/i.test(selectedPath)) return
    let cancelled = false
    ;(async () => {
      try {
        const parsed = await ipc.readFile(selectedPath)
        if (cancelled) return
        const fm = (parsed.frontmatter && typeof parsed.frontmatter === "object" && !Array.isArray(parsed.frontmatter))
          ? parsed.frontmatter as Record<string, unknown>
          : {}
        setOpenDoc({
          path: selectedPath,
          frontmatter: fm,
          rawMarkdown: parsed.body,
          blocks: null,
          dirty: false,
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
