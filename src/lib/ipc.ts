import { invoke } from "@tauri-apps/api/core"

export type TreeNode =
  | { kind: "dir"; name: string; path: string; children: TreeNode[] }
  | { kind: "file"; name: string; path: string }

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
  writeImage: (path: string, bytes: Uint8Array) =>
    invoke<void>("write_image", { path, bytes: Array.from(bytes) }),
  startWatcher: (root: string) => invoke<void>("start_watcher", { root }),
  stopWatcher: () => invoke<void>("stop_watcher"),
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
