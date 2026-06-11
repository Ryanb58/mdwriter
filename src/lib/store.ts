import { create } from "zustand"
import { persist, createJSONStorage } from "zustand/middleware"
import type { TreeNode, AgentId, AgentAvailability, PermissionMode, AiPermissionRequest } from "./ipc"

export type EditorMode = "block" | "raw"

export type OpenDoc = {
  path: string
  /**
   * Canonical document text — the bytes on disk, with frontmatter (if
   * any) as a `---\n…---\n\n` prefix followed by the body. Every view
   * (block editor body, raw editor, properties panel) is derived from
   * `text`; nothing else is persisted in the store.
   */
  text: string
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
  /**
   * True from launch until useStartupRestore has decided whether a recent
   * vault can be reopened. While true the app renders a neutral shell
   * instead of flashing "Open a folder" at users whose vault is about to
   * load. Never persisted.
   */
  startupRestoring: boolean
  setStartupRestoring(v: boolean): void
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
  pinnedPaths: string[]
  /**
   * Last markdown file that was open in each vault, persisted so relaunch
   * (and switching back to a vault) drops the user into the note they were
   * writing instead of an empty editor. Maintained by setOpenDoc.
   */
  lastFileByVault: Record<string, string>
  openDoc: OpenDoc | null
  /**
   * Bumped whenever an outside caller (e.g. "Apply to note", file watcher
   * reload) replaces `openDoc.text` so editors that key off the doc
   * identity re-init with the new content. User typing does *not* bump
   * this — it's specifically an "external replace" signal.
   */
  docRev: number
  bumpDocRev(): void
  editorMode: EditorMode
  rightPaneTab: RightPaneTab
  settingsOpen: boolean
  settings: Settings
  renamingPath: string | null
  pendingScroll: PendingScroll | null
  /**
   * One-shot signal that the next editor mount for this path should
   * land the cursor at the end of the document instead of the start.
   * Set by `createNewFile` after seeding a `# ` H1 so the user's first
   * keystroke types into the heading. Consumed and cleared by whichever
   * editor (block or raw) renders the file first.
   */
  pendingCursorAtEnd: string | null
  /**
   * Path of the open doc whose first H1 the block editor has observed the
   * user move *past* (a block exists after the heading, i.e. Enter was
   * pressed). Lets auto-rename treat the heading as "committed" in block
   * mode, where pressing Enter creates an empty trailing paragraph that
   * BlockNote's markdown export trims — so the doc text never changes and a
   * text-only signal would never fire. Path-keyed so it can't leak between
   * documents; cleared/updated by the editor as the document changes.
   */
  headingCommittedPath: string | null

  setRoot(path: string | null): void
  setTree(tree: TreeNode | null): void
  setRecent(list: string[]): void
  setSelected(path: string | null): void
  setSelectedPaths(paths: Set<string>, anchor: string | null): void
  toggleFolderExpanded(path: string, expanded?: boolean): void
  pinPath(path: string): void
  unpinPath(path: string): void
  togglePinnedPath(path: string): void
  remapPinnedPath(from: string, to: string): void
  removePinnedUnder(paths: readonly string[]): void
  setOpenDoc(doc: OpenDoc | null): void
  patchOpenDoc(patch: Partial<OpenDoc>): void
  setEditorMode(mode: EditorMode): void
  setRightPaneTab(tab: RightPaneTab): void
  setSettingsOpen(open: boolean): void
  setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void
  setRenamingPath(path: string | null): void
  setPendingScroll(target: PendingScroll | null): void
  setPendingCursorAtEnd(path: string | null): void
  setHeadingCommittedPath(path: string | null): void

  // AI session
  aiAgent: AgentId
  setAiAgent(id: AgentId): void
  /**
   * Permission posture for the agent subprocess. Defaults to accept-edits
   * (the previous hardcoded behavior). Users cycle through modes from the
   * AI panel header to opt into bypassing prompts or plan-only execution.
   */
  aiPermissionMode: PermissionMode
  setAiPermissionMode(mode: PermissionMode): void
  cycleAiPermissionMode(): void
  aiAvailable: AgentAvailability[]
  setAiAvailable(rows: AgentAvailability[]): void
  /**
   * Mirror of the active chat's `messages`. Kept as a top-level field so
   * existing selectors and helpers don't have to thread chat lookups.
   * The chats map remains the source of truth — every mutation here also
   * patches `chats[activeChatId].messages` and bumps `updatedAt`.
   */
  aiMessages: AiMessage[]
  appendAiMessage(msg: AiMessage): void
  setAiMessages(msgs: AiMessage[]): void
  patchLastAssistantMessage(patch: (m: AssistantMessage) => AssistantMessage): void
  clearAiMessages(): void
  aiRunning: boolean
  setAiRunning(v: boolean): void
  /**
   * In-flight permission requests, keyed by request id. The card UI reads
   * this map; `respondPermission` (or session shutdown) clears entries.
   * The order of insertion is preserved as `pendingPermissionOrder` so
   * multiple parallel approvals render top-to-bottom in the order they
   * arrived from the agent.
   */
  pendingPermissions: Record<string, PendingPermission>
  pendingPermissionOrder: string[]
  addPendingPermission(req: AiPermissionRequest): void
  resolvePendingPermission(id: string): void
  clearPendingPermissions(): void
  /** Vault-scoped chats keyed by id. Loaded by `useChatPersistence`. */
  chats: Record<string, Chat>
  activeChatId: string | null
  setChats(chats: Record<string, Chat>): void
  setActiveChat(id: string | null): void
  createChat(opts?: { activate?: boolean }): string
  renameChat(id: string, title: string): void
  setChatSystemPrompt(id: string, prompt: string): void
  deleteChat(id: string): void
  /** Accumulate token usage onto the active chat. No-op when none is active. */
  addChatUsage(turn: Partial<ChatUsage>): void
  /**
   * One-shot draft injected from outside the composer (e.g. "Edit and resend"
   * on a past user message). MessageInput consumes and clears it.
   */
  aiDraftRequest: { text: string; nonce: number } | null
  requestAiDraft(text: string): void
  consumeAiDraftRequest(): void

  /**
   * One-shot skill pill insertion request injected from outside the composer
   * (e.g. CommandMode palette). Unlike `aiDraftRequest` this is additive — it
   * inserts a pill at the current caret rather than replacing the draft.
   * MessageInput consumes and clears it.
   */
  aiSkillInsertRequest: { name: string; nonce: number } | null
  requestAiSkillInsert(name: string): void
  consumeAiSkillInsertRequest(): void

  /**
   * Whatever the user has highlighted in the active editor right now. Both
   * editor modes push into this — composer reads it to render a context
   * chip. `attached` flips to false when the user dismisses the chip and
   * back to true on the next non-empty selection.
   */
  editorSelection: { text: string; sourcePath: string | null; attached: boolean } | null
  setEditorSelection(s: { text: string; sourcePath: string | null } | null): void
  detachEditorSelection(): void
}

export type ToolCall = {
  id: string
  name: string
  input: unknown
  output: unknown | null
  isError: boolean
  finished: boolean
}

/**
 * A permission request awaiting the user's decision. Mirrors the wire
 * shape from `ai-permission`. `receivedAt` is used to sort the card list
 * stably when several arrive close together.
 */
export type PendingPermission = {
  id: string
  tool: string
  input: unknown
  toolUseId: string | null
  receivedAt: number
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

export type ChatUsage = {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
}

export type Chat = {
  id: string
  title: string
  agent: AgentId
  messages: AiMessage[]
  /** Per-thread system prompt prepended by `buildPrompt`. Empty = none. */
  systemPrompt: string
  /** Cumulative token usage across every assistant turn in this thread. */
  usage: ChatUsage
  createdAt: number
  updatedAt: number
}

export const EMPTY_USAGE: ChatUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
}

/**
 * Add a turn's usage into a running total. Tolerates missing fields — Claude
 * Code occasionally emits a "usage" object with only some keys populated.
 */
export function addUsage(prev: ChatUsage, turn: Partial<ChatUsage>): ChatUsage {
  return {
    inputTokens: prev.inputTokens + (turn.inputTokens ?? 0),
    outputTokens: prev.outputTokens + (turn.outputTokens ?? 0),
    cacheReadTokens: prev.cacheReadTokens + (turn.cacheReadTokens ?? 0),
    cacheCreationTokens: prev.cacheCreationTokens + (turn.cacheCreationTokens ?? 0),
  }
}

const TITLE_FROM_MESSAGE_LEN = 60

/**
 * Derive a short chat title from the user's first message. Stops at the
 * first newline so multi-paragraph prompts don't make a title with line
 * breaks in it. Empty input falls back to "New chat".
 */
export function deriveChatTitle(firstUserMessage: string): string {
  const trimmed = firstUserMessage.trim().split("\n")[0]?.trim() ?? ""
  if (!trimmed) return "New chat"
  return trimmed.length > TITLE_FROM_MESSAGE_LEN
    ? trimmed.slice(0, TITLE_FROM_MESSAGE_LEN).trimEnd() + "…"
    : trimmed
}

function makeChatId(): string {
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

const PERMISSION_MODE_ORDER: PermissionMode[] = [
  "accept-edits",
  "bypass-permissions",
  "plan",
]

/** Rotate to the next permission mode in the cycle. Wraps. */
export function nextPermissionMode(mode: PermissionMode): PermissionMode {
  const idx = PERMISSION_MODE_ORDER.indexOf(mode)
  return PERMISSION_MODE_ORDER[(idx + 1) % PERMISSION_MODE_ORDER.length]
}

const PERMISSION_MODE_LABELS: Record<PermissionMode, string> = {
  "accept-edits": "Accept edits",
  "plan": "Plan only",
  "bypass-permissions": "Bypass prompts",
}

export function permissionModeLabel(mode: PermissionMode): string {
  return PERMISSION_MODE_LABELS[mode]
}

function pickMostRecent(chats: Record<string, Chat>): string | null {
  const ids = Object.keys(chats)
  if (ids.length === 0) return null
  ids.sort((a, b) => chats[b].updatedAt - chats[a].updatedAt)
  return ids[0]
}

function remapPath(path: string, fromRoot: string, toRoot: string): string | null {
  if (path === fromRoot) return toRoot
  for (const sep of ["/", "\\"]) {
    const prefix = fromRoot + sep
    if (path.startsWith(prefix)) return toRoot + sep + path.slice(prefix.length)
  }
  return null
}

function isUnderAny(path: string, roots: readonly string[]): boolean {
  return roots.some((root) => remapPath(path, root, root) !== null)
}

/**
 * Update the active chat's `messages` (and optionally `title`) and mirror
 * the new messages onto the top-level `aiMessages` field. Auto-creates a
 * chat when none exists so the first user turn doesn't have to call
 * `createChat` itself.
 */
function withActiveChat(
  s: AppStore,
  updater: (chat: Chat, msgs: AiMessage[]) => Partial<Pick<Chat, "messages" | "title">>,
): Partial<AppStore> {
  let id = s.activeChatId
  let chats = s.chats
  if (!id || !chats[id]) {
    id = makeChatId()
    const now = Date.now()
    const fresh: Chat = {
      id,
      title: "",
      agent: s.aiAgent,
      messages: [],
      systemPrompt: "",
      usage: { ...EMPTY_USAGE },
      createdAt: now,
      updatedAt: now,
    }
    chats = { ...chats, [id]: fresh }
  }
  const chat = chats[id]
  const update = updater(chat, chat.messages)
  const messages = update.messages ?? chat.messages
  const title = update.title !== undefined ? update.title : chat.title
  const nextChat: Chat = { ...chat, messages, title, updatedAt: Date.now() }
  return {
    chats: { ...chats, [id]: nextChat },
    activeChatId: id,
    aiMessages: messages,
  }
}

export const useStore = create<AppStore>()(
  persist(
    (set) => ({
      rootPath: null,
      tree: null,
      startupRestoring: true,
      recentFolders: [],
      selectedPath: null,
      selectedPaths: new Set<string>(),
      expandedFolders: new Set<string>(),
      pinnedPaths: [],
      lastFileByVault: {},
      openDoc: null,
      docRev: 0,
      editorMode: "block",
      rightPaneTab: "properties",
      settingsOpen: false,
      settings: DEFAULT_SETTINGS,
      renamingPath: null,
      pendingScroll: null,
      pendingCursorAtEnd: null,
      headingCommittedPath: null,

      aiAgent: "claude-code" as AgentId,
      aiPermissionMode: "accept-edits" as PermissionMode,
      aiAvailable: [],
      aiMessages: [],
      aiRunning: false,
      pendingPermissions: {},
      pendingPermissionOrder: [],
      aiDraftRequest: null,
      aiSkillInsertRequest: null,
      editorSelection: null,
      chats: {},
      activeChatId: null,

      setRoot: (path) => set({ rootPath: path }),
      setStartupRestoring: (v) => set({ startupRestoring: v }),
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
      pinPath: (path) =>
        set((s) => s.pinnedPaths.includes(path) ? {} : { pinnedPaths: [...s.pinnedPaths, path] }),
      unpinPath: (path) =>
        set((s) => ({ pinnedPaths: s.pinnedPaths.filter((p) => p !== path) })),
      togglePinnedPath: (path) =>
        set((s) => s.pinnedPaths.includes(path)
          ? { pinnedPaths: s.pinnedPaths.filter((p) => p !== path) }
          : { pinnedPaths: [...s.pinnedPaths, path] }),
      remapPinnedPath: (from, to) =>
        set((s) => {
          let changed = false
          const seen = new Set<string>()
          const next: string[] = []
          for (const path of s.pinnedPaths) {
            const remapped = remapPath(path, from, to) ?? path
            if (remapped !== path) changed = true
            if (!seen.has(remapped)) {
              seen.add(remapped)
              next.push(remapped)
            }
          }
          return changed ? { pinnedPaths: next } : {}
        }),
      removePinnedUnder: (paths) =>
        set((s) => {
          const next = s.pinnedPaths.filter((p) => !isUnderAny(p, paths))
          return next.length === s.pinnedPaths.length ? {} : { pinnedPaths: next }
        }),
      setOpenDoc: (doc) =>
        set((s) => {
          const next: Partial<AppStore> = { openDoc: doc, editorMode: "block" }
          // Remember the open file per vault so relaunch can restore it.
          if (doc && s.rootPath && s.lastFileByVault[s.rootPath] !== doc.path) {
            next.lastFileByVault = { ...s.lastFileByVault, [s.rootPath]: doc.path }
          }
          return next
        }),
      patchOpenDoc: (patch) =>
        set((s) => (s.openDoc ? { openDoc: { ...s.openDoc, ...patch } } : {})),
      bumpDocRev: () => set((s) => ({ docRev: s.docRev + 1 })),
      setEditorMode: (mode) => set({ editorMode: mode }),
      setRightPaneTab: (tab) => set({ rightPaneTab: tab }),
      setSettingsOpen: (open) => set({ settingsOpen: open }),
      setSetting: (key, value) =>
        set((s) => ({ settings: { ...s.settings, [key]: value } })),
      setRenamingPath: (path) => set({ renamingPath: path }),
      setPendingScroll: (target) => set({ pendingScroll: target }),
      setPendingCursorAtEnd: (path) => set({ pendingCursorAtEnd: path }),
      setHeadingCommittedPath: (path) =>
        set((s) => (s.headingCommittedPath === path ? {} : { headingCommittedPath: path })),

      setAiAgent: (id) =>
        set((s) => {
          const next: Partial<AppStore> = { aiAgent: id }
          // Stamp the live agent onto the active chat so per-thread agent
          // choice is preserved on reload.
          if (s.activeChatId && s.chats[s.activeChatId]) {
            const chats = { ...s.chats }
            chats[s.activeChatId] = { ...chats[s.activeChatId], agent: id, updatedAt: Date.now() }
            next.chats = chats
          }
          return next
        }),
      setAiPermissionMode: (mode) => set({ aiPermissionMode: mode }),
      cycleAiPermissionMode: () =>
        set((s) => ({ aiPermissionMode: nextPermissionMode(s.aiPermissionMode) })),
      setAiAvailable: (rows) => set({ aiAvailable: rows }),
      appendAiMessage: (msg) =>
        set((s) => withActiveChat(s, (chat, msgs) => {
          const messages = [...msgs, msg]
          const title = chat.title || (msg.role === "user" ? deriveChatTitle(msg.text) : chat.title)
          return { messages, title }
        })),
      setAiMessages: (msgs) =>
        set((s) => withActiveChat(s, () => ({ messages: msgs }))),
      patchLastAssistantMessage: (patch) =>
        set((s) => withActiveChat(s, (_chat, msgs) => {
          const idx = msgs.findLastIndex((m) => m.role === "assistant")
          if (idx < 0) return {}
          const next = msgs.slice()
          next[idx] = patch(next[idx] as AssistantMessage)
          return { messages: next }
        })),
      clearAiMessages: () =>
        set((s) => withActiveChat(s, () => ({ messages: [] }))),
      setAiRunning: (v) => set({ aiRunning: v }),
      addPendingPermission: (req) =>
        set((s) => {
          // Idempotent: a re-emit (e.g. devtools hot-reload) shouldn't
          // produce a ghost card.
          if (s.pendingPermissions[req.id]) return {}
          const entry: PendingPermission = {
            id: req.id,
            tool: req.tool,
            input: req.input,
            toolUseId: req.toolUseId,
            receivedAt: Date.now(),
          }
          return {
            pendingPermissions: { ...s.pendingPermissions, [req.id]: entry },
            pendingPermissionOrder: [...s.pendingPermissionOrder, req.id],
          }
        }),
      resolvePendingPermission: (id) =>
        set((s) => {
          if (!s.pendingPermissions[id]) return {}
          const { [id]: _gone, ...rest } = s.pendingPermissions
          void _gone
          return {
            pendingPermissions: rest,
            pendingPermissionOrder: s.pendingPermissionOrder.filter((x) => x !== id),
          }
        }),
      clearPendingPermissions: () =>
        set({ pendingPermissions: {}, pendingPermissionOrder: [] }),
      setChats: (chats) =>
        set((s) => {
          // If the active chat was dropped (e.g. external delete), pick the
          // most-recently-updated remaining chat. None left → activeChatId is
          // cleared and `aiMessages` empties so the panel shows its empty state.
          const stillActive = s.activeChatId && chats[s.activeChatId]
          if (stillActive) {
            return { chats, aiMessages: chats[s.activeChatId!].messages }
          }
          const nextActive = pickMostRecent(chats)
          return {
            chats,
            activeChatId: nextActive,
            aiMessages: nextActive ? chats[nextActive].messages : [],
            aiAgent: nextActive ? chats[nextActive].agent : s.aiAgent,
          }
        }),
      setActiveChat: (id) =>
        set((s) => {
          if (id == null) return { activeChatId: null, aiMessages: [] }
          const chat = s.chats[id]
          if (!chat) return {}
          return {
            activeChatId: id,
            aiMessages: chat.messages,
            aiAgent: chat.agent,
          }
        }),
      createChat: (opts) => {
        const id = makeChatId()
        const now = Date.now()
        set((s) => {
          const chat: Chat = {
            id,
            title: "",
            agent: s.aiAgent,
            messages: [],
            systemPrompt: "",
            usage: { ...EMPTY_USAGE },
            createdAt: now,
            updatedAt: now,
          }
          const chats = { ...s.chats, [id]: chat }
          if (opts?.activate ?? true) {
            return { chats, activeChatId: id, aiMessages: [] }
          }
          return { chats }
        })
        return id
      },
      renameChat: (id, title) =>
        set((s) => {
          const chat = s.chats[id]
          if (!chat) return {}
          const chats = { ...s.chats, [id]: { ...chat, title, updatedAt: Date.now() } }
          return { chats }
        }),
      setChatSystemPrompt: (id, prompt) =>
        set((s) => {
          const chat = s.chats[id]
          if (!chat) return {}
          const chats = { ...s.chats, [id]: { ...chat, systemPrompt: prompt, updatedAt: Date.now() } }
          return { chats }
        }),
      deleteChat: (id) =>
        set((s) => {
          if (!s.chats[id]) return {}
          const { [id]: _gone, ...rest } = s.chats
          void _gone
          if (s.activeChatId !== id) {
            return { chats: rest }
          }
          const nextActive = pickMostRecent(rest)
          return {
            chats: rest,
            activeChatId: nextActive,
            aiMessages: nextActive ? rest[nextActive].messages : [],
            aiAgent: nextActive ? rest[nextActive].agent : s.aiAgent,
          }
        }),
      addChatUsage: (turn) =>
        set((s) => {
          if (!s.activeChatId) return {}
          const chat = s.chats[s.activeChatId]
          if (!chat) return {}
          const nextUsage = addUsage(chat.usage ?? EMPTY_USAGE, turn)
          return {
            chats: {
              ...s.chats,
              [s.activeChatId]: { ...chat, usage: nextUsage, updatedAt: Date.now() },
            },
          }
        }),
      requestAiDraft: (text) => set({ aiDraftRequest: { text, nonce: Date.now() } }),
      consumeAiDraftRequest: () => set({ aiDraftRequest: null }),
      requestAiSkillInsert: (name) =>
        set({ aiSkillInsertRequest: { name, nonce: Date.now() } }),
      consumeAiSkillInsertRequest: () => set({ aiSkillInsertRequest: null }),
      setEditorSelection: (s) =>
        set((state) => {
          if (!s || !s.text) return { editorSelection: null }
          // Re-attach on the next non-empty selection so the user can recover
          // from a previous dismissal by simply re-selecting.
          const prev = state.editorSelection
          const sameContent = prev && prev.text === s.text && prev.sourcePath === s.sourcePath
          return {
            editorSelection: {
              text: s.text,
              sourcePath: s.sourcePath,
              attached: sameContent ? prev.attached : true,
            },
          }
        }),
      detachEditorSelection: () =>
        set((s) => (s.editorSelection ? { editorSelection: { ...s.editorSelection, attached: false } } : {})),
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
        aiPermissionMode: s.aiPermissionMode,
        pinnedPaths: s.pinnedPaths,
        lastFileByVault: s.lastFileByVault,
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
        const pinnedPaths = Array.isArray(p.pinnedPaths)
          ? p.pinnedPaths.filter((path): path is string => typeof path === "string")
          : current.pinnedPaths
        const lastFileByVault: Record<string, string> = {}
        if (p.lastFileByVault && typeof p.lastFileByVault === "object") {
          for (const [vault, file] of Object.entries(p.lastFileByVault)) {
            if (typeof file === "string") lastFileByVault[vault] = file
          }
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
        return { ...current, ...rest, settings, rightPaneTab, pinnedPaths, lastFileByVault }
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
