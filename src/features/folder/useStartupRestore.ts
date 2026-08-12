import { useEffect } from "react"
import { ipc } from "../../lib/ipc"
import { useStore } from "../../lib/store"
import { openFolder, vaultWindow } from "./useFolderPicker"

export function useStartupRestore() {
  const setRoot = useStore((s) => s.setRoot)
  const setTree = useStore((s) => s.setTree)
  const setRecent = useStore((s) => s.setRecent)
  const setStartupRestoring = useStore((s) => s.setStartupRestoring)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const recent = await ipc.getRecentFolders()
        if (cancelled) return
        setRecent(recent)
        const candidate = recent[0]
        if (!candidate) return
        // A second window would otherwise restore the *same* most-recent vault
        // the first window already has open. It stays on the empty state
        // instead (S1.2), and unlike the user-driven open it does not focus the
        // window that owns the vault — that would pull focus off the window the
        // user just asked for.
        if (await vaultWindow(candidate)) return
        if (cancelled) return
        try {
          await openFolder(candidate, { setRoot, setTree, setRecent })
        } catch {
          // folder gone — stay on empty state
        }
      } catch {
        // Tauri not available (browser dev) — stay on empty state
      } finally {
        if (!cancelled) setStartupRestoring(false)
      }
    })()
    return () => { cancelled = true }
  }, [setRoot, setTree, setRecent, setStartupRestoring])
}
