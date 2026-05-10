import { useEffect } from "react"
import { ipc } from "../../lib/ipc"
import { useStore } from "../../lib/store"

export function useOpenFile() {
  const selectedPath = useStore((s) => s.selectedPath)
  const setOpenDoc = useStore((s) => s.setOpenDoc)

  useEffect(() => {
    if (!selectedPath) { setOpenDoc(null); return }
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
