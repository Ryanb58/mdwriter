import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../../lib/ipc", () => {
  const fs: {
    files: Map<string, { frontmatter: Record<string, unknown>; body: string }>
    listTreeCalls: number
  } = {
    files: new Map(),
    listTreeCalls: 0,
  }
  return {
    __fs: fs,
    ipc: {
      readFile: vi.fn(async (path: string) => {
        const f = fs.files.get(path)
        if (!f) throw new Error(`missing ${path}`)
        return { frontmatter: f.frontmatter, body: f.body }
      }),
      listTree: vi.fn(async () => {
        fs.listTreeCalls++
        return { kind: "dir" as const, name: "vault", path: "/vault", children: [] }
      }),
    },
  }
})

const cancelSpy = vi.fn()
vi.mock("../../editor/useAutoSave", () => ({
  cancelPendingDocSave: () => cancelSpy(),
}))

import { handleVaultChange, noteSelfWrite } from "../useExternalChanges"
import { useStore } from "../../../lib/store"
import * as ipcMod from "../../../lib/ipc"

function fs(): {
  files: Map<string, { frontmatter: Record<string, unknown>; body: string }>
  listTreeCalls: number
} {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (ipcMod as any).__fs
}

function openClean(path: string, body: string, frontmatter: Record<string, unknown> = {}) {
  fs().files.set(path, { frontmatter, body })
  useStore.setState({
    rootPath: "/vault",
    openDoc: {
      path,
      text: body,
      frontmatter,
      rawMarkdown: body,
      blocks: null,
      dirty: false,
      savedAt: Date.now(),
      parseError: null,
    },
    docRev: 0,
  })
}

beforeEach(() => {
  fs().files.clear()
  fs().listTreeCalls = 0
  cancelSpy.mockClear()
  useStore.setState({
    rootPath: null,
    openDoc: null,
    docRev: 0,
    tree: null,
  })
})

describe("handleVaultChange — open-doc reload", () => {
  it("reloads the open doc when an external write changes the bytes", async () => {
    openClean("/vault/a.md", "old body")
    fs().files.set("/vault/a.md", { frontmatter: {}, body: "new body from outside" })

    await handleVaultChange(["/vault/a.md"])

    const s = useStore.getState()
    expect(s.openDoc?.rawMarkdown).toBe("new body from outside")
    expect(s.openDoc?.dirty).toBe(false)
  })

  it("bumps docRev so the BlockEditor re-initialises from the new content", async () => {
    openClean("/vault/a.md", "old")
    fs().files.set("/vault/a.md", { frontmatter: {}, body: "new" })

    await handleVaultChange(["/vault/a.md"])

    // docRev started at 0; a reload must bump it so the editor's
    // `docKey = path#docRev` changes and forces a re-init.
    expect(useStore.getState().docRev).toBe(1)
  })

  it("cancels any pending autosave before applying external content", async () => {
    openClean("/vault/a.md", "old")
    fs().files.set("/vault/a.md", { frontmatter: {}, body: "new" })

    await handleVaultChange(["/vault/a.md"])

    expect(cancelSpy).toHaveBeenCalledTimes(1)
  })

  it("does nothing when external bytes are identical to the buffer (echo)", async () => {
    openClean("/vault/a.md", "same body")
    // disk still holds same content — this models the post-autosave echo

    await handleVaultChange(["/vault/a.md"])

    const s = useStore.getState()
    expect(s.docRev).toBe(0)
    expect(cancelSpy).not.toHaveBeenCalled()
  })

  it("preserves local edits when the doc is dirty", async () => {
    openClean("/vault/a.md", "buffer content")
    useStore.setState((prev) => ({ openDoc: { ...prev.openDoc!, dirty: true, rawMarkdown: "user typing in flight" } }))
    fs().files.set("/vault/a.md", { frontmatter: {}, body: "external write" })

    await handleVaultChange(["/vault/a.md"])

    const s = useStore.getState()
    expect(s.openDoc?.rawMarkdown).toBe("user typing in flight")
    expect(s.docRev).toBe(0)
    expect(cancelSpy).not.toHaveBeenCalled()
  })

  it("reloads even when the path is inside the self-write window", async () => {
    // Bug 3 regression: a vault-changed event arriving within the
    // self-write window used to be dropped entirely, so an external write
    // that landed right after an autosave was invisible to the editor and
    // got clobbered by the next save. We now always re-read and rely on
    // the bytes-equal check to filter true echoes.
    openClean("/vault/a.md", "old")
    fs().files.set("/vault/a.md", { frontmatter: {}, body: "external" })
    noteSelfWrite("/vault/a.md")

    await handleVaultChange(["/vault/a.md"])

    expect(useStore.getState().openDoc?.rawMarkdown).toBe("external")
    expect(useStore.getState().docRev).toBe(1)
  })

  it("treats a frontmatter-only external change as a reload", async () => {
    openClean("/vault/a.md", "same body", { title: "old" })
    fs().files.set("/vault/a.md", { frontmatter: { title: "new" }, body: "same body" })

    await handleVaultChange(["/vault/a.md"])

    expect(useStore.getState().openDoc?.frontmatter).toEqual({ title: "new" })
    expect(useStore.getState().docRev).toBe(1)
  })

  it("ignores events whose paths don't include the open doc", async () => {
    openClean("/vault/a.md", "old")
    fs().files.set("/vault/a.md", { frontmatter: {}, body: "old" })

    await handleVaultChange(["/vault/other.md"])

    expect(useStore.getState().docRev).toBe(0)
  })
})

describe("handleVaultChange — tree refresh", () => {
  it("refreshes the tree for an external change", async () => {
    openClean("/vault/a.md", "old")

    await handleVaultChange(["/vault/b.md"])

    expect(fs().listTreeCalls).toBe(1)
  })

  it("skips the tree refresh when every path is a recent self-write", async () => {
    openClean("/vault/a.md", "same")
    noteSelfWrite("/vault/a.md")

    await handleVaultChange(["/vault/a.md"])

    expect(fs().listTreeCalls).toBe(0)
  })

  it("bails entirely when there's no rootPath", async () => {
    // No openClean — rootPath remains null from beforeEach
    await handleVaultChange(["/vault/a.md"])
    expect(fs().listTreeCalls).toBe(0)
  })
})
