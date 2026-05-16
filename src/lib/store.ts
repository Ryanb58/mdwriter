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

export type RightPaneTab = "properties" | "ai"

/**
 * One-shot scroll target consumed by whichever editor is mounted after a doc
 * loads. Set by features that open a file at a specific location (vault
 * search, future "go to backlink", etc). The active editor consumes it and
 * clears it back to null — pending scrolls are *not* persisted.
 *
 * Both editors walk `matchText` occurrences in document order and stop at
 * `occurrence` (0-indexed) — this disambiguates when the same text appears
 * many times in a file. `line` is carried for the raw editor as a primary
 * positioning hint when an occurrence walk can't be completed (e.g. doc was
 * edited since the search ran).
 */
export type PendingScroll = {
  path: string
  line: number
  matchText: string
  occurrence: number
}

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
  // Full set of selected tree rows (multi-select). Invariant: when
  // selectedPath is non-null it is also a member of selectedPaths;
  // when selectedPaths is empty, selectedPath is null.
  selectedPaths: Set<string>
  // Folder paths that are currently expanded in the tree. Lifted into
  // the store so shift-range selection and drag-hover auto-expand can
  // both reason about visibility.
  expandedFolders: Set<string>
  openDoc: OpenDoc | null
  editorMode: EditorMode
  rightPaneTab: RightPaneTab
  settingsOpen: boolean
  settings: Settings
  renamingPath: string | null
  pendingScroll: PendingScroll | null

  setRoot(path: string | null): void
  setTree(tree: TreeNode | null): void
  setRecent(list: string[]): void
  setSelected(path: string | null): void
  setSelectedPaths(paths: Set<string>, anchor: string | null): void
  toggleFolderExpanded(path: string, expanded?: boolean): void
  setOpenDoc(doc: OpenDoc | null): void
  patchOpenDoc(patch: Partial<OpenDoc>): void
  setEditorMode(mode: EditorMode): void
  setRightPaneTab(tab: RightPaneTab): void
  setSettingsOpen(open: boolean): void
  setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void
  setRenamingPath(path: string | null): void
  setPendingScroll(target: PendingScroll | null): void

  // AI session
  aiAgent: AgentId
  setAiAgent(id: AgentId): void
  aiAvailable: AgentAvailability[]
  setAiAvailable(rows: AgentAvailability[]): void
  aiMessages: AiMessage[]
  appendAiMessage(msg: AiMessage): void
  setAiMessages(msgs: AiMessage[]): void
  patchLastAssistantMessage(patch: (m: AssistantMessage) => AssistantMessage): void
  clearAiMessages(): void
  aiRunning: boolean
  setAiRunning(v: boolean): void
  /**
   * One-shot draft injected from outside the composer (e.g. "Edit and resend"
   * on a past user message). MessageInput consumes and clears it.
   */
  aiDraftRequest: { text: string; nonce: number } | null
  requestAiDraft(text: string): void
  consumeAiDraftRequest(): void
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
      selectedPaths: new Set<string>(),
      expandedFolders: new Set<string>(),
      openDoc: null,
      editorMode: "block",
      rightPaneTab: "properties",
      settingsOpen: false,
      settings: DEFAULT_SETTINGS,
      renamingPath: null,
      pendingScroll: null,

      aiAgent: "claude-code" as AgentId,
      aiAvailable: [],
      aiMessages: [],
      aiRunning: false,
      aiDraftRequest: null,

      setRoot: (path) => set({ rootPath: path }),
      setTree: (tree) => set({ tree }),
      setRecent: (list) => set({ recentFolders: list }),
      setSelected: (path) =>
        set({
          selectedPath: path,
          selectedPaths: path ? new Set([path]) : new Set(),
        }),
      setSelectedPaths: (paths, anchor) =>
        set({
          selectedPaths: paths,
          // Keep the invariant: anchor must live in the set (or both empty).
          selectedPath: anchor && paths.has(anchor) ? anchor : null,
        }),
      toggleFolderExpanded: (path, expanded) =>
        set((s) => {
          const next = new Set(s.expandedFolders)
          const want = expanded ?? !next.has(path)
          if (want) next.add(path)
          else next.delete(path)
          return { expandedFolders: next }
        }),
      setOpenDoc: (doc) => set({ openDoc: doc, editorMode: "block" }),
      patchOpenDoc: (patch) =>
        set((s) => (s.openDoc ? { openDoc: { ...s.openDoc, ...patch } } : {})),
      setEditorMode: (mode) => set({ editorMode: mode }),
      setRightPaneTab: (tab) => set({ rightPaneTab: tab }),
      setSettingsOpen: (open) => set({ settingsOpen: open }),
      setSetting: (key, value) =>
        set((s) => ({ settings: { ...s.settings, [key]: value } })),
      setRenamingPath: (path) => set({ renamingPath: path }),
      setPendingScroll: (target) => set({ pendingScroll: target }),

      setAiAgent: (id) => set({ aiAgent: id }),
      setAiAvailable: (rows) => set({ aiAvailable: rows }),
      appendAiMessage: (msg) => set((s) => ({ aiMessages: [...s.aiMessages, msg] })),
      setAiMessages: (msgs) => set({ aiMessages: msgs }),
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
      requestAiDraft: (text) => set({ aiDraftRequest: { text, nonce: Date.now() } }),
      consumeAiDraftRequest: () => set({ aiDraftRequest: null }),
    }),
    {
      name: "mdwriter:store",
      storage: createJSONStorage(() => localStorage),
      // Only persist installation-local UI state — the vault, tree, and open
      // document are session-scoped and reload from disk on launch.
      partialize: (s) => ({
        settings: s.settings,
        rightPaneTab: s.rightPaneTab,
        aiAgent: s.aiAgent,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AppStore> & {
          propertiesVisible?: boolean
          aiPanelVisible?: boolean
          rightPane?: RightPaneTab | null
        }
        // Re-merge settings against DEFAULT_SETTINGS so any field added in a
        // later release picks up its default for users who persisted earlier.
        const settings = { ...DEFAULT_SETTINGS, ...(p.settings ?? {}) }
        const validLocations: ImagesLocation[] = ["vault-assets", "same-folder"]
        if (!validLocations.includes(settings.imagesLocation)) {
          settings.imagesLocation = DEFAULT_SETTINGS.imagesLocation
        }
        if (typeof settings.imageFilenameTemplate !== "string") {
          settings.imageFilenameTemplate = DEFAULT_SETTINGS.imageFilenameTemplate
        }
        // Migrate legacy tab + visibility flags into rightPaneTab. Layout
        // open/closed state is now owned by the layout module, so we only
        // recover the tab choice here.
        let rightPaneTab: RightPaneTab = current.rightPaneTab
        if (p.rightPaneTab === "properties" || p.rightPaneTab === "ai") {
          rightPaneTab = p.rightPaneTab
        } else if (p.rightPane === "ai" || p.aiPanelVisible) {
          rightPaneTab = "ai"
        } else if (p.rightPane === "properties" || p.propertiesVisible) {
          rightPaneTab = "properties"
        }
        const {
          propertiesVisible: _pv,
          aiPanelVisible: _av,
          rightPane: _rp,
          ...rest
        } = p
        void _pv; void _av; void _rp
        return { ...current, ...rest, settings, rightPaneTab }
      },
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
