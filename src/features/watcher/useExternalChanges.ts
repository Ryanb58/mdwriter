import { useEffect } from "react"
import { listen } from "@tauri-apps/api/event"
import { ipc } from "../../lib/ipc"
import { useStore, treeOptionsFromSettings } from "../../lib/store"

type VaultEvent = { paths: string[] }

const RECENT_WRITE_WINDOW_MS = 1000
const recentSelfWrites = new Map<string, number>()

export function noteSelfWrite(path: string) {
  recentSelfWrites.set(path, Date.now())
}

export function useExternalChanges() {
  useEffect(() => {
    const unlistenP = listen<VaultEvent>("vault-changed", async (e) => {
      const root = useStore.getState().rootPath
      if (!root) return

      const paths = e.payload.paths.filter((p) => {
        const at = recentSelfWrites.get(p)
        return !at || (Date.now() - at) > RECENT_WRITE_WINDOW_MS
      })
      if (paths.length === 0) return

      // Refresh tree (using current settings)
      try {
        const opts = treeOptionsFromSettings(useStore.getState().settings)
        const tree = await ipc.listTree(root, opts)
        useStore.setState({ tree })
      } catch (_err) { /* root went away */ }

      // If currently open file changed externally, reload it iff clean
      const doc = useStore.getState().openDoc
      if (doc && paths.includes(doc.path)) {
        if (doc.dirty) {
          console.warn(`External change to dirty file ${doc.path} — keeping local edits`)
        } else {
          try {
            const reparsed = await ipc.readFile(doc.path)
            const fm = (reparsed.frontmatter && typeof reparsed.frontmatter === "object" && !Array.isArray(reparsed.frontmatter))
              ? reparsed.frontmatter as Record<string, unknown>
              : {}
            useStore.getState().setOpenDoc({
              path: doc.path,
              frontmatter: fm,
              rawMarkdown: reparsed.body,
              blocks: null,
              dirty: false,
              savedAt: null,
              parseError: null,
            })
          } catch (_e) { /* file gone */ }
        }
      }
    })
    return () => { unlistenP.then((u) => u()) }
  }, [])
}
