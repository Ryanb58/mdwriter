import { create } from "zustand"
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

export type AppStore = {
  rootPath: string | null
  tree: TreeNode | null
  recentFolders: string[]
  selectedPath: string | null
  openDoc: OpenDoc | null
  editorMode: EditorMode
  propertiesVisible: boolean

  setRoot(path: string | null): void
  setTree(tree: TreeNode | null): void
  setRecent(list: string[]): void
  setSelected(path: string | null): void
  setOpenDoc(doc: OpenDoc | null): void
  patchOpenDoc(patch: Partial<OpenDoc>): void
  setEditorMode(mode: EditorMode): void
  toggleProperties(): void
}

export const useStore = create<AppStore>((set) => ({
  rootPath: null,
  tree: null,
  recentFolders: [],
  selectedPath: null,
  openDoc: null,
  editorMode: "block",
  propertiesVisible: true,

  setRoot: (path) => set({ rootPath: path }),
  setTree: (tree) => set({ tree }),
  setRecent: (list) => set({ recentFolders: list }),
  setSelected: (path) => set({ selectedPath: path }),
  setOpenDoc: (doc) => set({ openDoc: doc, editorMode: "block" }),
  patchOpenDoc: (patch) => set((s) => s.openDoc ? { openDoc: { ...s.openDoc, ...patch } } : {}),
  setEditorMode: (mode) => set({ editorMode: mode }),
  toggleProperties: () => set((s) => ({ propertiesVisible: !s.propertiesVisible })),
}))
