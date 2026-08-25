import { create } from "zustand"
import { persist } from "zustand/middleware"
import {
  createScopedPersistStorage,
  mergeRecencyLists,
  mergeRecords,
  mergeRecordsWith,
  mergeStringSets,
  type NormalizerMap,
  type ResolverMap,
  type ScopeMap,
} from "./persistStorage"
import { LAYOUT_WINDOW_KEYS } from "../layout/panelStorage"
import { PERSIST_WINDOW_LABEL, emitToAllWindows } from "./windowEvents"
import type {
  TreeNode,
  AgentId,
  AgentAvailability,
  PermissionMode,
  AiPermissionRequest,
  AgentBusyDetail,
} from "./ipc"
import { analyzeDocument, type DocumentRisk } from "./documentAnalysis"

export type EditorMode = "block" | "raw" | "reading"
export type EditingMode = Exclude<EditorMode, "reading">

export type SaveStatus = "clean" | "queued" | "saving" | "error" | "conflict"

export type LoadError = { path: string; message: string }

/** Which tab the right sidebar pane is showing. */
export type RightPaneTab = "properties" | "ai"

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
  markdownRisks: DocumentRisk[]
  contentFingerprint: string
  saveStatus: SaveStatus
  saveError: string | null
  /**
   * Digest of the bytes this window last saw on disk for `path` — set when the
   * document is read and re-set from every successful save. It is the save
   * precondition handed to `ipc.writeFile`: if disk no longer hashes to this,
   * another window (or another program) wrote the file and our save is refused
   * instead of clobbering it (reference behavior S2.3).
   *
   * `null` means "no precondition" — either the digest was never established
   * or the user explicitly chose to overwrite — and the next save is
   * unconditional.
   */
  diskDigest: string | null
}

export type OpenDocLifecyclePatch = Partial<
  Pick<OpenDoc, "path" | "dirty" | "savedAt" | "saveStatus" | "saveError" | "diskDigest">
>

/**
 * A save that was refused because the file changed on disk underneath this
 * window. The user's buffer is untouched (S2.2/S2.5) and automatic saving for
 * this path stays parked until they pick a resolution — this is what the
 * conflict dialog renders from.
 */
export type SaveConflict = {
  path: string
  /** Digest this window believed the file had. */
  expectedDigest: string
  /** Digest of the bytes now on disk. */
  actualDigest: string
  /**
   * The user closed the dialog without resolving. The conflict is still live
   * (saving stays blocked); the status bar offers a way back in.
   */
  dismissed: boolean
}

export type Theme = "light" | "dark" | "system"

export type VaultRevealTarget = {
  kind: "vault-reveal"
  path: string
  line: number
  matchText: string
  occurrence: number
}

export type RawFindTarget = {
  kind: "find-raw"
  path: string
  from: number
  to: number
  requestId: number
}

export type BlockFindTarget = {
  kind: "find-block"
  path: string
  blockId: string
  from: number
  to: number
  requestId: number
}

/** Session-only navigation request consumed or observed by the active editor. */
export type PendingScroll = VaultRevealTarget | RawFindTarget | BlockFindTarget

export type RenderedBlockEntry = { blockId: string; text: string }

export type RenderedBlockMatch = RenderedBlockEntry & { from: number; to: number }

export type BlockTextIndex = {
  path: string
  docKey: string
  blocks: RenderedBlockEntry[]
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
  loadingFolders: Set<string>
  folderLoadErrors: Record<string, string>
  pinnedPaths: string[]
  /**
   * Files most recently *opened in the app* per vault, newest first,
   * persisted. Drives the tree's Recent section ("what was I working on"),
   * and entry [0] is what relaunch restores. Maintained by setOpenDoc.
   * Deliberately not disk-mtime based — externally-touched files (git,
   * sync) shouldn't claim recency the user doesn't recognise.
   */
  recentFilesByVault: Record<string, string[]>
  openDoc: OpenDoc | null
  /**
   * Bumped whenever an outside caller (e.g. "Apply to note", file watcher
   * reload) replaces `openDoc.text` so editors that key off the doc
   * identity re-init with the new content. User typing does *not* bump
   * this — it's specifically an "external replace" signal.
   */
  docRev: number
  bumpDocRev(): void
  preferredEditorMode: EditingMode
  editorMode: EditorMode
  loadError: LoadError | null
  /**
   * A refused save waiting on the user. Window-scoped and never persisted —
   * it describes an in-memory buffer that only exists in this session.
   */
  saveConflict: SaveConflict | null
  blockModeOverrides: Record<string, string>
  /**
   * Which tab the right sidebar shows — frontmatter Properties for the open
   * file, or the AI Assistant. Persisted so the choice survives launches.
   */
  rightPaneTab: RightPaneTab
  /**
   * Focus mode: both side panels hidden, editor centered at a comfortable
   * measure. Session-scoped (never persisted) — toggled with ⌘⇧↩ or the
   * toolbar button; LayoutShell owns the panel stash/restore.
   */
  focusMode: boolean
  setFocusMode(v: boolean): void
  settingsOpen: boolean
  settings: Settings
  renamingPath: string | null
  pendingScroll: PendingScroll | null
  /** Session-only rendered text published by the mounted BlockNote editor. */
  blockTextIndex: BlockTextIndex | null
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
  setFolderLoading(path: string, loading: boolean): void
  setFolderLoadError(path: string, message: string | null): void
  clearFolderLoadState(): void
  pinPath(path: string): void
  unpinPath(path: string): void
  togglePinnedPath(path: string): void
  remapPinnedPath(from: string, to: string): void
  removePinnedUnder(paths: readonly string[]): void
  setOpenDoc(doc: OpenDoc | null): void
  /** Lifecycle metadata and path remaps only; content must use editOpenDoc. */
  patchOpenDoc(patch: OpenDocLifecyclePatch): void
  /**
   * Replace the open buffer with bytes read from disk. `diskDigest` is the
   * digest those bytes hashed to, and becomes the save precondition; omit it
   * only for callers that have no read to base one on.
   */
  openAnalyzedDocument(
    path: string,
    text: string,
    source: "disk" | "external",
    diskDigest?: string | null,
  ): void
  editOpenDoc(nextText: string): void
  requestEditorMode(mode: EditorMode): "changed" | "blocked"
  overrideBlockModeForCurrentDoc(): void
  remapBlockModeOverride(from: string, to: string): void
  setLoadError(error: LoadError | null): void
  setSaveConflict(conflict: SaveConflict | null): void
  setRightPaneTab(tab: RightPaneTab): void
  setSettingsOpen(open: boolean): void
  setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void
  setRenamingPath(path: string | null): void
  setPendingScroll(target: PendingScroll | null): void
  setBlockTextIndex(index: BlockTextIndex | null): void
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
   * Set when this window asked for an agent and was told another window owns
   * the one subprocess. Session-scoped and deliberately not persisted: it is a
   * fact about the app's current windows, and a stale one would disable the
   * composer on the next launch. Cleared by a successful send or by the user
   * dismissing the notice.
   */
  aiBusy: AgentBusyDetail | null
  setAiBusy(v: AgentBusyDetail | null): void
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

/** Per-vault cap on the recently-opened list (Recent shows the top 5). */
export const MAX_RECENT_FILES = 8

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

/** Exactly what `partialize` writes — the shape the storage layer splits by scope. */
export type PersistedSlice = {
  settings: Settings
  rightPaneTab: RightPaneTab
  aiAgent: AgentId
  aiPermissionMode: PermissionMode
  pinnedPaths: string[]
  recentFilesByVault: Record<string, string[]>
}

/**
 * Scope of each persisted key across windows. Every mdwriter window shares one
 * `localStorage`, so this classification is what decides whether a change in
 * window A reaches window B — see `persistStorage.ts` for the mechanics.
 *
 * - `settings`, `aiAgent`, `aiPermissionMode` are preferences: app-global, the
 *   way an editor's settings are. A change in A must show up in B.
 * - `pinnedPaths` and `recentFilesByVault` are keyed by vault, so they are
 *   global too — and `recentFilesByVault` is what session restore reads, which
 *   makes losing it the most expensive failure here.
 * - `rightPaneTab` is per-window chrome. Window B choosing the AI tab must not
 *   yank window A's sidebar over to it.
 */
export const PERSIST_SCOPES: ScopeMap<PersistedSlice> = {
  settings: "shared",
  aiAgent: "shared",
  aiPermissionMode: "shared",
  pinnedPaths: "shared",
  recentFilesByVault: "shared",
  rightPaneTab: "window",
}

/**
 * How to reconcile a shared key another window changed since we last read it.
 * Without these, two windows changing *different* fields of the same entry in
 * the same instant would still clobber each other; with them, only a genuine
 * edit of the same field by both windows is last-writer-wins.
 */
export const PERSIST_RESOLVERS: ResolverMap<PersistedSlice> = {
  // Per-field: A flips the theme while B flips `showPdfs` → both survive.
  settings: (mine, disk, base) => mergeRecords(mine, disk, base),
  // Two levels, because two windows can be on the *same* vault (S1.5's
  // focus-instead-of-duplicate is best-effort — `vaultWindow` returns null on
  // any lookup failure). The outer level keeps a window from touching a vault
  // it never opened; the inner one merges that vault's list entry-by-entry, so
  // a document A just opened survives B saving its own copy of the same list.
  // Resolving per vault key alone loses one of the two opens permanently, and
  // since restore reads index 0, the window that lost it reopens the *other*
  // window's document.
  recentFilesByVault: (mine, disk, base) =>
    mergeRecordsWith(mine, disk, base, (mineList, diskList, baseList) =>
      mergeRecencyLists(mineList, diskList, baseList, MAX_RECENT_FILES),
    ),
  // Membership: our pins/unpins apply on top of whatever the other window did.
  pinnedPaths: (mine, disk, base) => mergeStringSets(mine, disk, base),
}

/**
 * Canonical form of each persisted entry: exactly what this window holds in
 * memory after loading it.
 *
 * These are the *same* functions the store's `merge` and cross-window adoption
 * run, and that is the point. A stored entry is routinely not in canonical form
 * — settings written before a field existed lack it, a recents list written
 * when the cap was higher is too long — and the store fills those in on load.
 * Without normalizing at the storage layer too, the merge ancestor would be the
 * raw text while memory held the filled-in value, so every field the store
 * defaulted would look like a local edit and get pushed over another window's
 * real choice on the next keystroke. Entries are rewritten in canonical form
 * when they are read, so disk, ancestor and memory stay one value.
 */
export const PERSIST_NORMALIZERS: NormalizerMap<PersistedSlice> = {
  settings: normalizeSettings,
  pinnedPaths: normalizePinnedPaths,
  recentFilesByVault: normalizeRecentFilesByVault,
  rightPaneTab: normalizeRightPaneTab,
}

/** Broadcast so other windows re-read the shared entries we just wrote. */
export const SHARED_PERSIST_EVENT = "mdwriter:shared-persist-changed"

export type SharedPersistPayload = { origin: string }

/** Re-exported: window identity lives with the window helpers. */
export { PERSIST_WINDOW_LABEL }

const persistedStorage = createScopedPersistStorage<PersistedSlice>({
  scopes: PERSIST_SCOPES,
  resolvers: PERSIST_RESOLVERS,
  normalizers: PERSIST_NORMALIZERS,
  windowLabel: PERSIST_WINDOW_LABEL,
  storage: localStorage,
  extraWindowKeys: LAYOUT_WINDOW_KEYS,
  migrateLegacy: legacyPersistedSlice,
  onSharedWrite: () => {
    try {
      void emitToAllWindows(SHARED_PERSIST_EVENT, {
        origin: PERSIST_WINDOW_LABEL,
      } satisfies SharedPersistPayload).catch(() => {})
    } catch {
      // No Tauri runtime (browser dev / tests): the DOM `storage` event that
      // `useSharedPersistSync` also listens for covers same-origin tabs.
    }
  },
  // A write that had to merge in another window's changes wrote more to disk
  // than this window holds in memory. Adopt the merged result so the UI matches
  // disk and the next merge base is honest. Deferred: we are inside `setState`.
  onMergedWrite: () => queueMicrotask(syncSharedPersistedState),
})

/** Test seam: the scoped storage backing `useStore.persist`. */
export const persistedStorageForTests = persistedStorage

/**
 * Re-read the app-global persisted entries and adopt them.
 *
 * This is what makes a preference changed in window A visible in window B
 * without a relaunch, and — just as important — it re-bases this window's
 * write cache, so B's next write no longer carries a stale copy of A's value.
 * Applying it is cheap and idempotent: values that already match produce no
 * further writes.
 */
export function syncSharedPersistedState(): void {
  const disk = persistedStorage.readShared()
  useStore.setState((current) => normalizeSharedPersisted(disk, current))
}

function normalizeSettings(raw: unknown): Settings {
  // Re-merge against DEFAULT_SETTINGS so any field added in a later release
  // picks up its default for users who persisted earlier.
  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    ...(raw && typeof raw === "object" ? (raw as Partial<Settings>) : {}),
  }
  const validLocations: ImagesLocation[] = ["vault-assets", "same-folder"]
  if (!validLocations.includes(settings.imagesLocation)) {
    settings.imagesLocation = DEFAULT_SETTINGS.imagesLocation
  }
  if (typeof settings.imageFilenameTemplate !== "string") {
    settings.imageFilenameTemplate = DEFAULT_SETTINGS.imageFilenameTemplate
  }
  return settings
}

function normalizePinnedPaths(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((path): path is string => typeof path === "string")
}

function normalizeRecentFilesByVault(raw: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  if (!raw || typeof raw !== "object") return out
  for (const [vault, files] of Object.entries(raw as Record<string, unknown>)) {
    if (Array.isArray(files)) {
      out[vault] = files.filter((f): f is string => typeof f === "string").slice(0, MAX_RECENT_FILES)
    }
  }
  return out
}

function normalizeRightPaneTab(raw: unknown): RightPaneTab {
  return raw === "ai" || raw === "properties" ? raw : "properties"
}

type SharedPersistedState = Pick<
  AppStore,
  "settings" | "pinnedPaths" | "recentFilesByVault" | "aiAgent" | "aiPermissionMode"
>

/**
 * Validate the app-global entries against the state they would replace.
 *
 * Two deliberate omissions: keys absent from storage are left alone rather than
 * reset to defaults (a partial read can never wipe live state), and values that
 * already match are dropped rather than re-set, so re-reading after every
 * cross-window notification costs no re-renders.
 */
function normalizeSharedPersisted(
  p: Partial<PersistedSlice>,
  current: SharedPersistedState,
): Partial<AppStore> {
  const out: Partial<AppStore> = {}
  if (p.settings !== undefined) {
    const settings = normalizeSettings(p.settings)
    if (!sameJson(settings, current.settings)) out.settings = settings
  }
  // Each branch runs the same normalizer the storage layer canonicalizes with,
  // so what lands in memory is byte-identical to what backs the merge ancestor.
  if (p.pinnedPaths !== undefined) {
    const pinnedPaths = normalizePinnedPaths(p.pinnedPaths)
    if (!sameJson(pinnedPaths, current.pinnedPaths)) out.pinnedPaths = pinnedPaths
  }
  if (p.recentFilesByVault !== undefined) {
    const recentFilesByVault = normalizeRecentFilesByVault(p.recentFilesByVault)
    if (!sameJson(recentFilesByVault, current.recentFilesByVault)) {
      out.recentFilesByVault = recentFilesByVault
    }
  }
  // The agent shown in the picker follows the last explicit choice in any
  // window. The per-chat `agent` stamp is only rewritten by an explicit pick in
  // the window that owns the chat, so an adopted value never rewrites history.
  if (p.aiAgent !== undefined && p.aiAgent !== current.aiAgent) out.aiAgent = p.aiAgent
  if (p.aiPermissionMode !== undefined && p.aiPermissionMode !== current.aiPermissionMode) {
    out.aiPermissionMode = p.aiPermissionMode
  }
  return out
}

function sameJson(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b)
}

/** Validate the per-window entries. */
function normalizeWindowPersisted(p: Partial<PersistedSlice>): Partial<AppStore> {
  if (p.rightPaneTab === undefined) return {}
  return { rightPaneTab: normalizeRightPaneTab(p.rightPaneTab) }
}

/**
 * Translate the pre-split `mdwriter:store` blob into the current slice, keeping
 * the key renames earlier releases went through. Runs once, when the scoped
 * storage migrates that blob into per-key entries; values are validated later
 * by the normalizers, same as any other read.
 */
export function legacyPersistedSlice(legacy: Record<string, unknown>): Partial<PersistedSlice> {
  const out: Partial<PersistedSlice> = {}
  if (legacy.settings && typeof legacy.settings === "object") {
    out.settings = legacy.settings as Settings
  }
  if (typeof legacy.aiAgent === "string") out.aiAgent = legacy.aiAgent as AgentId
  if (typeof legacy.aiPermissionMode === "string") {
    out.aiPermissionMode = legacy.aiPermissionMode as PermissionMode
  }
  if (Array.isArray(legacy.pinnedPaths)) out.pinnedPaths = legacy.pinnedPaths as string[]

  const recentFilesByVault: Record<string, string[]> = {}
  if (legacy.recentFilesByVault && typeof legacy.recentFilesByVault === "object") {
    for (const [vault, files] of Object.entries(legacy.recentFilesByVault)) {
      if (Array.isArray(files)) recentFilesByVault[vault] = files as string[]
    }
  }
  // The short-lived lastFileByVault shape (single path per vault) becomes a
  // one-element recency list.
  if (legacy.lastFileByVault && typeof legacy.lastFileByVault === "object") {
    for (const [vault, file] of Object.entries(legacy.lastFileByVault)) {
      if (typeof file === "string" && !recentFilesByVault[vault]) {
        recentFilesByVault[vault] = [file]
      }
    }
  }
  if (Object.keys(recentFilesByVault).length > 0) out.recentFilesByVault = recentFilesByVault

  // Recover the right-pane tab choice, migrating from the older visibility
  // flags. Layout open/closed state is owned by the layout module — only which
  // *tab* the pane shows is restored here.
  if (legacy.rightPaneTab === "properties" || legacy.rightPaneTab === "ai") {
    out.rightPaneTab = legacy.rightPaneTab
  } else if (legacy.rightPane === "ai" || legacy.aiPanelVisible) {
    out.rightPaneTab = "ai"
  } else if (legacy.rightPane === "properties" || legacy.propertiesVisible) {
    out.rightPaneTab = "properties"
  }
  return out
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
      loadingFolders: new Set<string>(),
      folderLoadErrors: {},
      pinnedPaths: [],
      recentFilesByVault: {},
      openDoc: null,
      docRev: 0,
      preferredEditorMode: "block",
      editorMode: "block",
      loadError: null,
      saveConflict: null,
      blockModeOverrides: {},
      rightPaneTab: "properties",
      focusMode: false,
      settingsOpen: false,
      settings: DEFAULT_SETTINGS,
      renamingPath: null,
      pendingScroll: null,
      blockTextIndex: null,
      pendingCursorAtEnd: null,
      headingCommittedPath: null,

      aiAgent: "claude-code" as AgentId,
      aiPermissionMode: "accept-edits" as PermissionMode,
      aiAvailable: [],
      aiMessages: [],
      aiRunning: false,
      aiBusy: null,
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
      setFolderLoading: (path, loading) =>
        set((s) => {
          const next = new Set(s.loadingFolders)
          if (loading) next.add(path)
          else next.delete(path)
          return { loadingFolders: next }
        }),
      setFolderLoadError: (path, message) =>
        set((s) => {
          if (message === null) {
            if (!(path in s.folderLoadErrors)) return {}
            const { [path]: _removed, ...rest } = s.folderLoadErrors
            void _removed
            return { folderLoadErrors: rest }
          }
          return {
            folderLoadErrors: { ...s.folderLoadErrors, [path]: message },
          }
        }),
      clearFolderLoadState: () =>
        set({ loadingFolders: new Set<string>(), folderLoadErrors: {} }),
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
          // Any prior editor selection refers to the buffer being replaced
          // (file switch or watcher reload), so it can't stay attached to the
          // AI composer — drop it.
          const next: Partial<AppStore> = { openDoc: doc, editorMode: "block", editorSelection: null }
          // Record the open in this vault's recency list (newest first,
          // deduped, capped) so the Recent section and relaunch restore
          // both reflect what the user actually opened.
          if (doc && s.rootPath) {
            const cur = s.recentFilesByVault[s.rootPath] ?? []
            if (cur[0] !== doc.path) {
              const updated = [doc.path, ...cur.filter((p) => p !== doc.path)].slice(0, MAX_RECENT_FILES)
              next.recentFilesByVault = { ...s.recentFilesByVault, [s.rootPath]: updated }
            }
          }
          return next
        }),
      patchOpenDoc: (patch) =>
        set((s) => (s.openDoc ? { openDoc: { ...s.openDoc, ...patch } } : {})),
      openAnalyzedDocument: (path, text, _source, diskDigest = null) => {
        const analysis = analyzeDocument(path, text)
        set((s) => {
          const existingOverride = s.blockModeOverrides[path]
          const overrideMatches = existingOverride === analysis.contentFingerprint
          let blockModeOverrides = s.blockModeOverrides
          if (existingOverride && !overrideMatches) {
            const { [path]: _stale, ...rest } = blockModeOverrides
            void _stale
            blockModeOverrides = rest
          }

          const hasRisks = analysis.markdownRisks.length > 0
          const editorMode: EditorMode = hasRisks
            ? (overrideMatches ? "block" : "raw")
            : s.preferredEditorMode
          const doc: OpenDoc = {
            path,
            text,
            dirty: false,
            savedAt: null,
            ...analysis,
            saveStatus: "clean",
            saveError: null,
            diskDigest,
          }
          const next: Partial<AppStore> = {
            openDoc: doc,
            docRev: s.docRev + 1,
            editorMode,
            loadError: null,
            // Reading the file is itself a resolution: whatever the buffer and
            // disk disagreed about, this buffer *is* disk now.
            saveConflict: s.saveConflict?.path === path ? null : s.saveConflict,
            blockModeOverrides,
            blockTextIndex: null,
            pendingScroll:
              s.pendingScroll?.kind === "find-raw" || s.pendingScroll?.kind === "find-block"
                ? null
                : s.pendingScroll,
            editorSelection: null,
          }

          if (s.rootPath) {
            const cur = s.recentFilesByVault[s.rootPath] ?? []
            if (cur[0] !== path) {
              const updated = [path, ...cur.filter((p) => p !== path)].slice(0, MAX_RECENT_FILES)
              next.recentFilesByVault = { ...s.recentFilesByVault, [s.rootPath]: updated }
            }
          }
          return next
        })
      },
      editOpenDoc: (nextText) =>
        set((s) => {
          const doc = s.openDoc
          if (!doc || doc.text === nextText) return {}
          const analysis = analyzeDocument(doc.path, nextText)
          const hadActiveOverride = s.blockModeOverrides[doc.path] === doc.contentFingerprint
          let blockModeOverrides = s.blockModeOverrides
          if (hadActiveOverride) {
            blockModeOverrides = {
              ...blockModeOverrides,
              [doc.path]: analysis.contentFingerprint,
            }
          } else if (blockModeOverrides[doc.path]) {
            const { [doc.path]: _stale, ...rest } = blockModeOverrides
            void _stale
            blockModeOverrides = rest
          }
          // A conflict is not a transient failure a keystroke can retry (see
          // writeDoc.ts's conflictPath park) — it stays on screen with its
          // message until the user resolves it, instead of flickering back to
          // "Unsaved" the moment they keep typing.
          const preserveStatus = doc.saveStatus === "saving" || doc.saveStatus === "conflict"
          return {
            openDoc: {
              ...doc,
              text: nextText,
              dirty: true,
              ...analysis,
              saveStatus: preserveStatus ? doc.saveStatus : "queued",
              saveError: preserveStatus ? doc.saveError : null,
            },
            blockModeOverrides,
          }
        }),
      requestEditorMode: (mode) => {
        let result: "changed" | "blocked" = "changed"
        set((s) => {
          if (mode === "reading") return { editorMode: "reading" }
          if (mode === "raw") {
            return { preferredEditorMode: "raw", editorMode: "raw" }
          }
          const doc = s.openDoc
          const isRisky = Boolean(doc?.markdownRisks.length)
          const isOverridden = Boolean(
            doc && s.blockModeOverrides[doc.path] === doc.contentFingerprint,
          )
          if (isRisky && !isOverridden) {
            result = "blocked"
            return { preferredEditorMode: "block" }
          }
          return { preferredEditorMode: "block", editorMode: "block" }
        })
        return result
      },
      overrideBlockModeForCurrentDoc: () =>
        set((s) => {
          const doc = s.openDoc
          if (!doc || doc.markdownRisks.length === 0) return {}
          return {
            editorMode: "block",
            blockModeOverrides: {
              ...s.blockModeOverrides,
              [doc.path]: doc.contentFingerprint,
            },
          }
        }),
      remapBlockModeOverride: (from, to) =>
        set((s) => {
          let changed = false
          const next: Record<string, string> = {}
          for (const [path, fingerprint] of Object.entries(s.blockModeOverrides)) {
            const remapped = remapPath(path, from, to) ?? path
            if (remapped !== path) changed = true
            next[remapped] = fingerprint
          }
          return changed ? { blockModeOverrides: next } : {}
        }),
      setLoadError: (loadError) => set({ loadError }),
      setSaveConflict: (saveConflict) => set({ saveConflict }),
      bumpDocRev: () => set((s) => ({ docRev: s.docRev + 1 })),
      setRightPaneTab: (tab) => set({ rightPaneTab: tab }),
      setFocusMode: (v) => set({ focusMode: v }),
      setSettingsOpen: (open) => set({ settingsOpen: open }),
      setSetting: (key, value) =>
        set((s) => ({ settings: { ...s.settings, [key]: value } })),
      setRenamingPath: (path) => set({ renamingPath: path }),
      setPendingScroll: (target) => set({ pendingScroll: target }),
      setBlockTextIndex: (index) => set({ blockTextIndex: index }),
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
      setAiBusy: (v) => set({ aiBusy: v }),
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
      // The scoped storage below derives its own keys per persisted field and
      // ignores this name; it is kept only because `persist` requires one.
      name: "mdwriter",
      storage: persistedStorage,
      // Only persist installation-local UI state — the vault, tree, and open
      // document are session-scoped and reload from disk on launch.
      partialize: (s): PersistedSlice => ({
        settings: s.settings,
        rightPaneTab: s.rightPaneTab,
        aiAgent: s.aiAgent,
        aiPermissionMode: s.aiPermissionMode,
        pinnedPaths: s.pinnedPaths,
        recentFilesByVault: s.recentFilesByVault,
      }),
      // Restore only the exact keys written by `partialize`. Older builds
      // briefly persisted broader state shapes, so spreading `p` here would
      // revive stale documents, load errors, or compatibility overrides.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<PersistedSlice>
        return {
          ...current,
          settings: normalizeSettings(p.settings),
          ...normalizeSharedPersisted(p, current),
          ...normalizeWindowPersisted(p),
        }
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
