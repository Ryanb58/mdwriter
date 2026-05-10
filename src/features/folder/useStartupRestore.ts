import { useEffect } from "react"
import { ipc } from "../../lib/ipc"
import { useStore } from "../../lib/store"
import { openFolder } from "./useFolderPicker"

export function useStartupRestore() {
  const setRoot = useStore((s) => s.setRoot)
  const setTree = useStore((s) => s.setTree)
  const setRecent = useStore((s) => s.setRecent)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const recent = await ipc.getRecentFolders()
      if (cancelled) return
      setRecent(recent)
      const candidate = recent[0]
      if (!candidate) return
      try {
        await openFolder(candidate, { setRoot, setTree, setRecent })
      } catch {
        // folder gone — stay on empty state
      }
    })()
    return () => { cancelled = true }
  }, [setRoot, setTree, setRecent])
}
