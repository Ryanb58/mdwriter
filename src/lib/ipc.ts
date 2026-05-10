import { invoke } from "@tauri-apps/api/core"

export type TreeNode =
  | { kind: "dir"; name: string; path: string; children: TreeNode[] }
  | { kind: "file"; name: string; path: string }

export type ParsedDoc = {
  frontmatter: unknown
  body: string
}

export const ipc = {
  listTree: (root: string) => invoke<TreeNode>("list_tree", { root }),
  readFile: (path: string) => invoke<ParsedDoc>("read_file", { path }),
  writeFile: (path: string, doc: ParsedDoc) => invoke<void>("write_file", { path, doc }),
  createFile: (path: string) => invoke<void>("create_file", { path }),
  createDir: (path: string) => invoke<void>("create_dir", { path }),
  renamePath: (from: string, to: string) => invoke<void>("rename_path", { from, to }),
  trashPath: (path: string) => invoke<void>("trash_path", { path }),
  startWatcher: (root: string) => invoke<void>("start_watcher", { root }),
  stopWatcher: () => invoke<void>("stop_watcher"),
  getRecentFolders: () => invoke<string[]>("get_recent_folders"),
  pushRecentFolder: (folder: string) => invoke<void>("push_recent_folder", { folder }),
}
