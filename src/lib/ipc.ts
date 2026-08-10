import { invoke } from "@tauri-apps/api/core"

/**
 * Single facade over Tauri's `invoke`. No other frontend module should call
 * `invoke()` directly (see CLAUDE.md). Each wrapper below mirrors the Rust
 * command of the same `snake_case` name in `src-tauri/src/commands/*.rs`;
 * the TS types here are the canonical contract for the frontend and are
 * cross-checked against the Rust `serde` (de)serialization on each side.
 *
 * Naming convention: Rust returns `snake_case` field names (except structs
 * tagged `#[serde(rename_all = "camelCase")]`). Where a command returns a
 * snake_case struct, we declare a private `*Raw` interface that matches the
 * wire shape exactly, then map it to the camelCase type the rest of the app
 * consumes. `*Raw` interfaces never escape this module.
 */

/**
 * Anything Rust can hand back through a `serde_json::Value` return: a fully
 * arbitrary, but still JSON-shaped, value. Narrower than `unknown` (excludes
 * `undefined`, functions, symbols, which serde_json cannot emit) while still
 * forcing callers to narrow before use.
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

/**
 * Mirror of Rust `commands::fs::TreeNode`
 * (`#[serde(tag = "kind", rename_all = "lowercase")]`). `path` is a Rust
 * `PathBuf` (serialized as a string). `mtime` is `Option<i64>` with
 * `skip_serializing_if = "Option::is_none"`, so it is absent (not `null`)
 * when the filesystem can't report it — hence the optional `?`, not `| null`.
 */
export type TreeNode =
  | { kind: "dir"; name: string; path: string; children: TreeNode[]; loaded: boolean }
  | { kind: "file"; name: string; path: string; mtime?: number }

export type TreeOptions = {
  includePdfs?: boolean
  includeImages?: boolean
  includeUnsupported?: boolean
  hideGitignored?: boolean
}

export type SearchHit = {
  path: string
  /** 1-indexed line number within the file. */
  line: number
  /** Byte offset of the match start within `snippet`. */
  colStart: number
  /** Byte offset of the match end within `snippet`. */
  colEnd: number
  /** Trimmed line with leading/trailing `…` when the original was long. */
  snippet: string
}

export type SearchResult = {
  hits: SearchHit[]
  truncated: boolean
  filesScanned: number
}

export type SearchOptions = {
  caseSensitive?: boolean
  hideGitignored?: boolean
}

export type AgentId = "claude-code" | "codex" | "open-code" | "pi" | "gemini"

/** Permission posture for the agent subprocess. Maps to Claude Code's
 *  `--permission-mode` flag; other adapters interpret it loosely or ignore. */
export type PermissionMode = "accept-edits" | "plan" | "bypass-permissions"

export type SkillSource = "vault-claude" | "vault-agents" | "user-claude" | "user-agents"

export type Skill = {
  name: string
  description: string
  source: SkillSource
  absPath: string
  vaultRelPath: string | null
}

export type AgentAvailability = {
  id: AgentId
  label: string
  available: boolean
  binaryPath: string | null
  implemented: boolean
}

/**
 * Mirror of Rust `commands::agents::AiStreamEvent`
 * (`#[serde(tag = "kind", rename_all = "kebab-case",
 * rename_all_fields = "camelCase")]`). Emitted on the `ai-stream` channel,
 * not returned from an `invoke` — frontend listeners decode this shape.
 * `input`/`output`/`usage` are Rust `serde_json::Value` (`usage` is an
 * `Option`, hence `| null`).
 */
export type AiStreamEvent =
  | { kind: "text"; text: string }
  | { kind: "tool-start"; id: string; name: string; input: JsonValue }
  | { kind: "tool-result"; id: string; isError: boolean; output: JsonValue }
  | { kind: "error"; message: string }
  | { kind: "done"; usage: JsonValue | null }

/**
 * Emitted on the `ai-permission` channel when the agent's subprocess is
 * paused waiting for the user to approve a tool call. Each pending request
 * carries a stable `id` that the frontend echoes back through
 * `respondPermission` to unblock the subprocess.
 */
export type AiPermissionRequest = {
  id: string
  tool: string
  /** Rust `serde_json::Value` — the raw tool-call input. */
  input: JsonValue
  toolUseId: string | null
}

export type PermissionDecision = "allow" | "deny"

/**
 * Persisted chat metadata returned by `list_chats`. Mirror of Rust
 * `commands::chats::ChatSummary` after the snake_case→camelCase mapping in
 * the `listChats` wrapper. `createdAt`/`updatedAt` are Unix-epoch values
 * (Rust `i64`).
 */
export type ChatSummary = {
  id: string
  title: string
  createdAt: number
  updatedAt: number
}

// ── Wire-shape (`*Raw`) interfaces ─────────────────────────────────────────
// These match the exact snake_case JSON emitted by the corresponding Rust
// command. They are mapped to camelCase app types inside `ipc` and never
// leave this module.

/** Wire shape of Rust `commands::search::SearchHit`. */
type SearchHitRaw = {
  path: string
  line: number
  col_start: number
  col_end: number
  snippet: string
}

/** Wire shape of Rust `commands::search::SearchResult`. */
type SearchResultRaw = {
  hits: SearchHitRaw[]
  truncated: boolean
  files_scanned: number
}

/** Wire shape of Rust `commands::agents::AgentAvailability`. */
type AgentAvailabilityRaw = {
  id: AgentId
  label: string
  available: boolean
  binary_path: string | null
  implemented: boolean
}

/** Wire shape of Rust `commands::chats::ChatSummary`. */
type ChatSummaryRaw = {
  id: string
  title: string
  updated_at: number
  created_at: number
}

/** Wire shape of Rust `commands::skills::SkillMeta`. */
type SkillMetaRaw = {
  name: string
  description: string
  source: SkillSource
  abs_path: string
  vault_rel_path: string | null
}

export const ipc = {
  listTree: (root: string, options?: TreeOptions) =>
    invoke<TreeNode>("list_tree", { root, options: options ?? null }),
  listDirectory: (path: string, options?: TreeOptions) =>
    invoke<TreeNode>("list_directory", { path, options: options ?? null }),
  readFile: (path: string) => invoke<string>("read_file", { path }),
  writeFile: (path: string, text: string) => invoke<void>("write_file", { path, text }),
  createFile: (path: string) => invoke<void>("create_file", { path }),
  createDir: (path: string) => invoke<void>("create_dir", { path }),
  renamePath: (from: string, to: string) => invoke<void>("rename_path", { from, to }),
  trashPath: (path: string) => invoke<void>("trash_path", { path }),
  // Tauri's IPC JSON-encodes args, so a multi-megabyte Uint8Array sent
  // as a number array stalls on big pastes. FileReader.readAsDataURL
  // is the fastest browser path to base64 for a Blob.
  writeImage: async (path: string, bytes: Uint8Array): Promise<void> => {
    const bytesB64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        const result = reader.result as string
        resolve(result.slice(result.indexOf(",") + 1))
      }
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(new Blob([bytes as BlobPart]))
    })
    return invoke<void>("write_image", { path, bytesB64 })
  },
  importFile: async (path: string, bytes: Uint8Array): Promise<void> => {
    const bytesB64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        const result = reader.result as string
        resolve(result.slice(result.indexOf(",") + 1))
      }
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(new Blob([bytes as BlobPart]))
    })
    return invoke<void>("import_file", { path, bytesB64 })
  },
  searchVault: (root: string, query: string, options?: SearchOptions): Promise<SearchResult> =>
    invoke<SearchResultRaw>("search_vault", { root, query, options: options ?? null }).then((r) => ({
      hits: r.hits.map((h) => ({
        path: h.path,
        line: h.line,
        colStart: h.col_start,
        colEnd: h.col_end,
        snippet: h.snippet,
      })),
      truncated: r.truncated,
      filesScanned: r.files_scanned,
    } satisfies SearchResult)),
  startWatcher: (root: string) => invoke<void>("start_watcher", { root }),
  stopWatcher: () => invoke<void>("stop_watcher"),
  ensureVaultAgentsMd: (vaultPath: string) =>
    invoke<boolean>("ensure_vault_agents_md", { vaultPath }),
  getRecentFolders: () => invoke<string[]>("get_recent_folders"),
  pushRecentFolder: (folder: string) => invoke<void>("push_recent_folder", { folder }),
  detectAgents: (): Promise<AgentAvailability[]> =>
    invoke<AgentAvailabilityRaw[]>("detect_agents").then((rows) =>
      rows.map((r) => ({
        id: r.id,
        label: r.label,
        available: r.available,
        binaryPath: r.binary_path,
        implemented: r.implemented,
      } satisfies AgentAvailability))
    ),
  startAiSession: (
    agent: AgentId,
    prompt: string,
    vaultPath: string,
    permissionMode?: PermissionMode | null,
  ) =>
    invoke<void>("start_ai_session", {
      agent,
      prompt,
      vaultPath,
      permissionMode: permissionMode ?? null,
    }),
  stopAiSession: () => invoke<void>("stop_ai_session"),
  respondPermission: (
    id: string,
    decision: PermissionDecision,
    opts?: { message?: string; updatedInput?: JsonValue },
  ) =>
    invoke<boolean>("respond_permission", {
      id,
      decision,
      message: opts?.message ?? null,
      // Tauri's serde maps camelCase JS fields to snake_case Rust args via
      // its built-in renamer, so `updatedInput` reaches `updated_input`.
      updatedInput: opts?.updatedInput ?? null,
    }),
  /**
   * Extend the current session's allowlist so subsequent matching tool
   * calls auto-allow without a card. `pathPrefix` is matched against the
   * tool input's `file_path` or `path` field (case-sensitive).
   */
  addPermissionRule: (tool: string, pathPrefix?: string | null) =>
    invoke<boolean>("add_permission_rule", {
      tool,
      pathPrefix: pathPrefix ?? null,
    }),
  listChats: (vaultPath: string): Promise<ChatSummary[]> =>
    invoke<ChatSummaryRaw[]>("list_chats", { vaultPath }).then((rows) =>
      rows.map((r) => ({
        id: r.id,
        title: r.title,
        updatedAt: r.updated_at,
        createdAt: r.created_at,
      } satisfies ChatSummary)),
    ),
  // Rust round-trips opaque JSON (`serde_json::Value`) — the frontend owns the
  // chat shape. Reads come back as a precise `JsonValue`; writes accept any
  // serializable value (`unknown`), since callers pass app types whose leaves
  // are themselves `unknown` and TS can't prove their JSON-ness up front.
  readChat: (vaultPath: string, id: string): Promise<JsonValue> =>
    invoke<JsonValue>("read_chat", { vaultPath, id }),
  writeChat: (vaultPath: string, id: string, data: unknown): Promise<void> =>
    invoke<void>("write_chat", { vaultPath, id, data }),
  deleteChat: (vaultPath: string, id: string) =>
    invoke<void>("delete_chat", { vaultPath, id }),
  listSkills: (rootPath: string | null): Promise<Skill[]> =>
    invoke<SkillMetaRaw[]>("list_skills", { rootPath }).then((rows) =>
      rows.map((r) => ({
        name: r.name,
        description: r.description,
        source: r.source,
        absPath: r.abs_path,
        vaultRelPath: r.vault_rel_path,
      } satisfies Skill))
    ),
}
