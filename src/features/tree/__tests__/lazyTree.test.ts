import { describe, expect, it } from "vitest"
import type { TreeNode } from "../../../lib/ipc"
import {
  ancestorDirectories,
  loadedDirectoryPaths,
  replaceDirectory,
} from "../lazyTree"

const file = (path: string): TreeNode => ({
  kind: "file",
  name: path.slice(path.lastIndexOf("/") + 1),
  path,
})

const dir = (
  path: string,
  children: TreeNode[] = [],
  loaded = true,
): TreeNode => ({
  kind: "dir",
  name: path.slice(path.lastIndexOf("/") + 1) || path,
  path,
  children,
  loaded,
})

describe("replaceDirectory", () => {
  it("preserves a loaded descendant that remains in a refreshed listing", () => {
    const loadedDeep = dir("/vault/notes/deep", [file("/vault/notes/deep/a.md")])
    const root = dir("/vault", [
      dir("/vault/notes", [loadedDeep, file("/vault/notes/removed.md")]),
    ])
    const refreshed = dir("/vault/notes", [
      dir("/vault/notes/deep", [], false),
      file("/vault/notes/new.md"),
    ])

    const next = replaceDirectory(root, refreshed)

    expect(next).not.toBe(root)
    expect(next && next.kind === "dir" ? next.children[0] : null).toEqual(
      dir("/vault/notes", [loadedDeep, file("/vault/notes/new.md")]),
    )
  })

  it("does not resurrect a child removed from the refreshed listing", () => {
    const root = dir("/vault", [dir("/vault/notes", [file("/vault/notes/old.md")])])

    const next = replaceDirectory(root, dir("/vault/notes", []))

    const notes = next && next.kind === "dir" ? next.children[0] : null
    expect(notes && notes.kind === "dir" ? notes.children : null).toEqual([])
  })

  it("returns the original tree when the target directory is absent", () => {
    const root = dir("/vault", [file("/vault/a.md")])

    expect(replaceDirectory(root, dir("/vault/missing"))).toBe(root)
    expect(replaceDirectory(root, file("/vault/a.md"))).toBe(root)
  })
})

describe("loadedDirectoryPaths", () => {
  it("returns only loaded directories in document order", () => {
    const root = dir("/vault", [
      dir("/vault/loaded", [dir("/vault/loaded/deep")]),
      dir("/vault/cold", [], false),
    ])

    expect(loadedDirectoryPaths(root)).toEqual([
      "/vault",
      "/vault/loaded",
      "/vault/loaded/deep",
    ])
  })
})

describe("ancestorDirectories", () => {
  it("returns the in-vault parent chain without the root", () => {
    expect(ancestorDirectories("/vault", "/vault/notes/deep/a.md")).toEqual([
      "/vault/notes",
      "/vault/notes/deep",
    ])
  })

  it("rejects the root itself, sibling prefixes, and outside paths", () => {
    expect(ancestorDirectories("/vault", "/vault")).toEqual([])
    expect(ancestorDirectories("/vault", "/vault-other/a.md")).toEqual([])
    expect(ancestorDirectories("/vault", "/outside/a.md")).toEqual([])
  })
})
