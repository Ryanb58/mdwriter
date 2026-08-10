import { ipc } from "../../lib/ipc"
import { useStore, treeOptionsFromSettings } from "../../lib/store"
import { errorText } from "../../lib/toast"
import { parent } from "../../lib/paths"
import { findNode } from "./findNode"
import {
  ancestorDirectories,
  loadedDirectoryPaths,
  replaceDirectory,
} from "./lazyTree"

type LoadResult = "loaded" | "missing" | "stale"
type RevealResult = "found" | "missing" | "stale"

const inFlight = new Map<string, Promise<LoadResult>>()
const generations = new Map<string, number>()

export function loadDirectory(path: string): Promise<LoadResult> {
  const root = useStore.getState().rootPath
  if (!root) return Promise.resolve("stale")
  const key = `${root}\0${path}`
  const existing = inFlight.get(key)
  if (existing) return existing

  const node = findNode(useStore.getState().tree, path)
  if (node?.kind !== "dir") return Promise.resolve("missing")

  const generation = (generations.get(key) ?? 0) + 1
  generations.set(key, generation)
  const { setFolderLoading, setFolderLoadError } = useStore.getState()
  setFolderLoading(path, true)
  setFolderLoadError(path, null)

  const request = (async (): Promise<LoadResult> => {
    try {
      const options = treeOptionsFromSettings(useStore.getState().settings)
      const listing = await ipc.listDirectory(path, options)
      const current = useStore.getState()
      if (
        current.rootPath !== root ||
        generations.get(key) !== generation
      ) {
        return "stale"
      }
      if (findNode(current.tree, path)?.kind !== "dir") return "missing"
      const tree = replaceDirectory(current.tree, listing)
      if (tree === current.tree) return "missing"
      useStore.setState({ tree })
      return "loaded"
    } catch (error) {
      const current = useStore.getState()
      if (
        current.rootPath !== root ||
        generations.get(key) !== generation
      ) {
        return "stale"
      }
      current.setFolderLoadError(path, errorText(error))
      return "missing"
    } finally {
      const current = useStore.getState()
      if (
        current.rootPath === root &&
        generations.get(key) === generation
      ) {
        current.setFolderLoading(path, false)
      }
      if (generations.get(key) === generation) inFlight.delete(key)
    }
  })()

  inFlight.set(key, request)
  return request
}

export async function revealPath(path: string): Promise<RevealResult> {
  const root = useStore.getState().rootPath
  if (!root) return "stale"
  const ancestors = ancestorDirectories(root, path)
  if (parent(path) !== root && ancestors.length === 0) return "missing"

  for (const directory of ancestors) {
    if (useStore.getState().rootPath !== root) return "stale"
    const node = findNode(useStore.getState().tree, directory)
    if (node?.kind !== "dir") return "missing"
    if (!node.loaded) {
      const result = await loadDirectory(directory)
      if (result !== "loaded") return result === "stale" ? "stale" : "missing"
    }
    useStore.getState().toggleFolderExpanded(directory, true)
  }

  if (useStore.getState().rootPath !== root) return "stale"
  return findNode(useStore.getState().tree, path)?.kind === "file"
    ? "found"
    : "missing"
}

export async function refreshDirectories(paths: readonly string[]): Promise<void> {
  const unique = [...new Set(paths)]
  await Promise.all(unique.map(async (path) => {
    const node = findNode(useStore.getState().tree, path)
    if (node?.kind === "dir" && node.loaded) await loadDirectory(path)
  }))
}

export async function reloadLoadedDirectories(): Promise<void> {
  const state = useStore.getState()
  const root = state.rootPath
  if (!root) return
  const loaded = loadedDirectoryPaths(state.tree)
  const options = treeOptionsFromSettings(state.settings)
  const tree = await ipc.listTree(root, options)
  if (useStore.getState().rootPath !== root) return
  useStore.setState({ tree, loadingFolders: new Set(), folderLoadErrors: {} })

  const descendants = loaded
    .filter((path) => path !== root)
    .sort((a, b) => a.length - b.length)
  for (const path of descendants) {
    if (useStore.getState().rootPath !== root) return
    const node = findNode(useStore.getState().tree, path)
    if (node?.kind === "dir" && !node.loaded) await loadDirectory(path)
  }
}
