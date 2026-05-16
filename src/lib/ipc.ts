import { invoke } from "@tauri-apps/api/core"

export type TreeNode =
  | { kind: "dir"; name: string; path: string; children: TreeNode[] }
  | { kind: "file"; name: string; path: string; mtime?: number }

export type ParsedDoc = {
  frontmatter: unknown
  body: string
}

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

export type AgentAvailability = {
  id: AgentId
  label: string
  available: boolean
  binaryPath: string | null
  implemented: boolean
}

export type AiStreamEvent =
  | { kind: "text"; text: string }
  | { kind: "tool-start"; id: string; name: string; input: unknown }
  | { kind: "tool-result"; id: string; isError: boolean; output: unknown }
  | { kind: "error"; message: string }
  | { kind: "done"; usage: unknown | null }

export const ipc = {
  listTree: (root: string, options?: TreeOptions) =>
    invoke<TreeNode>("list_tree", { root, options: options ?? null }),
  readFile: (path: string) => invoke<ParsedDoc>("read_file", { path }),
  writeFile: (path: string, doc: ParsedDoc) => invoke<void>("write_file", { path, doc }),
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
  searchVault: (root: string, query: string, options?: SearchOptions) =>
    invoke<{
      hits: Array<{
        path: string
        line: number
        col_start: number
        col_end: number
        snippet: string
      }>
      truncated: boolean
      files_scanned: number
    }>("search_vault", { root, query, options: options ?? null }).then((r) => ({
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
  detectAgents: () =>
    invoke<Array<{
      id: AgentId
      label: string
      available: boolean
      binary_path: string | null
      implemented: boolean
    }>>("detect_agents").then((rows) =>
      rows.map((r) => ({
        id: r.id,
        label: r.label,
        available: r.available,
        binaryPath: r.binary_path,
        implemented: r.implemented,
      } satisfies AgentAvailability))
    ),
  startAiSession: (agent: AgentId, prompt: string, vaultPath: string) =>
    invoke<void>("start_ai_session", { agent, prompt, vaultPath }),
  stopAiSession: () => invoke<void>("stop_ai_session"),
}
