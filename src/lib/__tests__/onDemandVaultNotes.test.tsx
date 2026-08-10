import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../ipc", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../ipc")>()
  return {
    ...actual,
    ipc: {
      ...actual.ipc,
      listMarkdownNotes: vi.fn(),
    },
  }
})

import { ipc } from "../ipc"
import { useStore } from "../store"
import { useOnDemandVaultNotes } from "../vaultNotes"

const listMarkdownNotes = vi.mocked(ipc.listMarkdownNotes)

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

describe("useOnDemandVaultNotes", () => {
  beforeEach(() => {
    listMarkdownNotes.mockReset()
    useStore.setState({ rootPath: "/vault" })
  })

  it("loads once for a mounted requester and becomes ready", async () => {
    listMarkdownNotes.mockResolvedValue([
      { name: "Elsewhere", path: "/vault/deep/elsewhere.md", rel: "deep/elsewhere.md", mtime: 42 },
    ])

    const { result, rerender } = renderHook(() => useOnDemandVaultNotes(true))

    expect(result.current.status).toBe("loading")
    await waitFor(() => expect(result.current.status).toBe("ready"))
    expect(result.current.notes).toEqual([
      { name: "Elsewhere", path: "/vault/deep/elsewhere.md", rel: "deep/elsewhere.md", mtime: 42 },
    ])
    rerender()
    expect(listMarkdownNotes).toHaveBeenCalledTimes(1)
  })

  it("does not request notes while disabled", () => {
    const { result } = renderHook(() => useOnDemandVaultNotes(false))

    expect(result.current).toEqual({ notes: [], status: "idle", error: null })
    expect(listMarkdownNotes).not.toHaveBeenCalled()
  })

  it("ignores an old response after the vault changes", async () => {
    const first = deferred<Awaited<ReturnType<typeof ipc.listMarkdownNotes>>>()
    listMarkdownNotes
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce([
        { name: "New", path: "/new/new.md", rel: "new.md" },
      ])
    const { result } = renderHook(() => useOnDemandVaultNotes(true))

    act(() => useStore.setState({ rootPath: "/new" }))
    first.resolve([{ name: "Old", path: "/vault/old.md", rel: "old.md" }])

    await waitFor(() => expect(result.current.status).toBe("ready"))
    expect(result.current.notes.map((note) => note.name)).toEqual(["New"])
    expect(listMarkdownNotes).toHaveBeenCalledTimes(2)
  })

  it("keeps results local to each mount", async () => {
    listMarkdownNotes.mockResolvedValue([
      { name: "One", path: "/vault/one.md", rel: "one.md" },
    ])
    const first = renderHook(() => useOnDemandVaultNotes(true))
    await waitFor(() => expect(first.result.current.status).toBe("ready"))
    first.unmount()

    const second = renderHook(() => useOnDemandVaultNotes(true))
    await waitFor(() => expect(second.result.current.status).toBe("ready"))

    expect(listMarkdownNotes).toHaveBeenCalledTimes(2)
  })
})
