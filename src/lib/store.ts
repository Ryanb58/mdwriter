import { create } from "zustand"
import { persist, createJSONStorage } from "zustand/middleware"
import type { TreeNode } from "./ipc"

export type EditorMode = "block" | "raw"

export type OpenDoc = {
  path: string
  frontmatter: Record<string, unknown>
  rawMarkdown: string
  blocks: unknown[] | null
  dirty: boolean
  savedAt: number | null
  parseError: string | null
}

export type Theme = "light" | "dark" | "system"

export type Settings = {
  theme: Theme
  autoRenameFromH1: boolean
  hideGitignored: boolean
  showPdfs: boolean
  showImages: boolean
  showUnsupported: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  autoRenameFromH1: true,
  hideGitignored: false,
  showPdfs: false,
  showImages: false,
  showUnsupported: false,
}

export type AppStore = {
  rootPath: string | null
  tree: TreeNode | null
  recentFolders: string[]
  selectedPath: string | null
  openDoc: OpenDoc | null
  editorMode: EditorMode
  propertiesVisible: boolean
  settingsOpen: boolean
  settings: Settings
  renamingPath: string | null

  setRoot(path: string | null): void
  setTree(tree: TreeNode | null): void
  setRecent(list: string[]): void
  setSelected(path: string | null): void
  setOpenDoc(doc: OpenDoc | null): void
  patchOpenDoc(patch: Partial<OpenDoc>): void
  setEditorMode(mode: EditorMode): void
  toggleProperties(): void
  setSettingsOpen(open: boolean): void
  setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void
  setRenamingPath(path: string | null): void
}

export const useStore = create<AppStore>()(
  persist(
    (set) => ({
      rootPath: null,
      tree: null,
      recentFolders: [],
      selectedPath: null,
      openDoc: null,
      editorMode: "block",
      propertiesVisible: true,
      settingsOpen: false,
      settings: DEFAULT_SETTINGS,
      renamingPath: null,

      setRoot: (path) => set({ rootPath: path }),
      setTree: (tree) => set({ tree }),
      setRecent: (list) => set({ recentFolders: list }),
      setSelected: (path) => set({ selectedPath: path }),
      setOpenDoc: (doc) => set({ openDoc: doc, editorMode: "block" }),
      patchOpenDoc: (patch) =>
        set((s) => (s.openDoc ? { openDoc: { ...s.openDoc, ...patch } } : {})),
      setEditorMode: (mode) => set({ editorMode: mode }),
      toggleProperties: () => set((s) => ({ propertiesVisible: !s.propertiesVisible })),
      setSettingsOpen: (open) => set({ settingsOpen: open }),
      setSetting: (key, value) =>
        set((s) => ({ settings: { ...s.settings, [key]: value } })),
      setRenamingPath: (path) => set({ renamingPath: path }),
    }),
    {
      name: "mdwriter:store",
      storage: createJSONStorage(() => localStorage),
      // Only persist installation-local UI state — the vault, tree, and open
      // document are session-scoped and reload from disk on launch.
      partialize: (s) => ({
        settings: s.settings,
        propertiesVisible: s.propertiesVisible,
      }),
    },
  ),
)

export function treeOptionsFromSettings(s: Settings) {
  return {
    includePdfs: s.showPdfs,
    includeImages: s.showImages,
    includeUnsupported: s.showUnsupported,
    hideGitignored: s.hideGitignored,
  }
}
