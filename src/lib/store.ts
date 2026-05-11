import { create } from "zustand"
import { persist, createJSONStorage } from "zustand/middleware"
import type { TreeNode, AgentId, AgentAvailability } from "./ipc"

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

export type ImagesLocation = "vault-assets" | "same-folder"

export type Settings = {
  theme: Theme
  autoRenameFromH1: boolean
  hideGitignored: boolean
  showPdfs: boolean
  showImages: boolean
  showUnsupported: boolean
  imagesLocation: ImagesLocation
  imageFilenameTemplate: string
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  autoRenameFromH1: true,
  hideGitignored: false,
  showPdfs: false,
  showImages: false,
  showUnsupported: false,
  imagesLocation: "vault-assets",
  imageFilenameTemplate: "{date}-{time}-{rand}",
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

  // AI panel
  aiPanelVisible: boolean
  toggleAiPanel(): void
  setAiPanelVisible(v: boolean): void
  aiAgent: AgentId
  setAiAgent(id: AgentId): void
  aiAvailable: AgentAvailability[]
  setAiAvailable(rows: AgentAvailability[]): void
  aiMessages: AiMessage[]
  appendAiMessage(msg: AiMessage): void
  patchLastAssistantMessage(patch: (m: AssistantMessage) => AssistantMessage): void
  clearAiMessages(): void
  aiRunning: boolean
  setAiRunning(v: boolean): void
}

export type ToolCall = {
  id: string
  name: string
  input: unknown
  output: unknown | null
  isError: boolean
  finished: boolean
}

export type AssistantMessage = {
  role: "assistant"
  text: string
  tools: ToolCall[]
  finished: boolean
}

export type AiMessage =
  | { role: "user"; text: string }
  | AssistantMessage
  | { role: "system"; text: string }

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

      aiPanelVisible: false,
      aiAgent: "claude-code" as AgentId,
      aiAvailable: [],
      aiMessages: [],
      aiRunning: false,

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

      toggleAiPanel: () => set((s) => ({ aiPanelVisible: !s.aiPanelVisible })),
      setAiPanelVisible: (v) => set({ aiPanelVisible: v }),
      setAiAgent: (id) => set({ aiAgent: id }),
      setAiAvailable: (rows) => set({ aiAvailable: rows }),
      appendAiMessage: (msg) => set((s) => ({ aiMessages: [...s.aiMessages, msg] })),
      patchLastAssistantMessage: (patch) =>
        set((s) => {
          const idx = s.aiMessages.findLastIndex((m) => m.role === "assistant")
          if (idx < 0) return {}
          const next = s.aiMessages.slice()
          next[idx] = patch(next[idx] as AssistantMessage)
          return { aiMessages: next }
        }),
      clearAiMessages: () => set({ aiMessages: [] }),
      setAiRunning: (v) => set({ aiRunning: v }),
    }),
    {
      name: "mdwriter:store",
      storage: createJSONStorage(() => localStorage),
      // Only persist installation-local UI state — the vault, tree, and open
      // document are session-scoped and reload from disk on launch.
      partialize: (s) => ({
        settings: s.settings,
        propertiesVisible: s.propertiesVisible,
        aiPanelVisible: s.aiPanelVisible,
        aiAgent: s.aiAgent,
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
