import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const saveHarness = vi.hoisted(() => ({
  flushOpenDocSave: vi.fn(),
}))

vi.mock("../../../lib/ipc", () => ({
  ipc: {
    readFile: vi.fn(),
  },
}))

vi.mock("../../../lib/writeDoc", () => ({
  flushOpenDocSave: saveHarness.flushOpenDocSave,
}))

import { ipc } from "../../../lib/ipc"
import { useStore } from "../../../lib/store"
import { DocumentLoadState } from "../DocumentLoadState"
import { useOpenFile } from "../useOpenFile"

const readFile = vi.mocked(ipc.readFile)

function Harness() {
  const { retry } = useOpenFile()
  const doc = useStore((state) => state.openDoc)
  const loadError = useStore((state) => state.loadError)

  return (
    <div>
      {loadError && <DocumentLoadState error={loadError} onRetry={retry} />}
      {doc && <textarea aria-label="Editor" value={doc.text} readOnly />}
    </div>
  )
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe("useOpenFile", () => {
  beforeEach(() => {
    readFile.mockReset()
    saveHarness.flushOpenDocSave.mockReset()
    saveHarness.flushOpenDocSave.mockResolvedValue(undefined)
    useStore.setState({
      selectedPath: null,
      selectedPaths: new Set(),
      tree: null,
      openDoc: null,
      editorMode: "block",
      preferredEditorMode: "block",
      loadError: null,
      blockModeOverrides: {},
    })
  })

  it("opens a risky read directly in raw mode", async () => {
    readFile.mockResolvedValue("A note with a footnote[^one].")
    useStore.setState({
      selectedPath: "/vault/risky.md",
      selectedPaths: new Set(["/vault/risky.md"]),
    })

    render(<Harness />)

    await waitFor(() => expect(useStore.getState().openDoc?.path).toBe("/vault/risky.md"))
    expect(useStore.getState().editorMode).toBe("raw")
    expect(useStore.getState().loadError).toBeNull()
  })

  it("keeps a prior dirty note when the selected file cannot be read", async () => {
    useStore.getState().openAnalyzedDocument("/vault/working.md", "Before", "disk")
    useStore.getState().editOpenDoc("Unsaved work")
    readFile.mockRejectedValue(new Error("permission denied"))
    useStore.setState({
      selectedPath: "/vault/blocked.md",
      selectedPaths: new Set(["/vault/blocked.md"]),
    })

    render(<Harness />)

    await screen.findByRole("alert")
    expect(useStore.getState().openDoc).toMatchObject({
      path: "/vault/working.md",
      text: "Unsaved work",
      dirty: true,
    })
    expect(useStore.getState().loadError).toEqual({
      path: "/vault/blocked.md",
      message: "permission denied",
    })
  })

  it("does not create an empty editable document after a read failure", async () => {
    readFile.mockRejectedValue(new Error("missing file"))
    useStore.setState({
      selectedPath: "/vault/missing.md",
      selectedPaths: new Set(["/vault/missing.md"]),
    })

    render(<Harness />)

    await screen.findByRole("alert")
    expect(useStore.getState().openDoc).toBeNull()
    expect(screen.queryByRole("textbox", { name: "Editor" })).not.toBeInTheDocument()
  })

  it("shows the message from a serialized Tauri read error", async () => {
    readFile.mockRejectedValue({ kind: "Io", message: "permission denied" })
    useStore.getState().setSelected("/vault/blocked.md")

    render(<Harness />)

    await screen.findByText("permission denied")
    expect(useStore.getState().loadError).toEqual({
      path: "/vault/blocked.md",
      message: "permission denied",
    })
  })

  it("retries the selected read and clears the error only after success", async () => {
    const retryRead = deferred<string>()
    readFile
      .mockRejectedValueOnce(new Error("temporarily unavailable"))
      .mockImplementationOnce(() => retryRead.promise)
    useStore.setState({
      selectedPath: "/vault/retry.md",
      selectedPaths: new Set(["/vault/retry.md"]),
    })

    render(<Harness />)
    await screen.findByText("temporarily unavailable")

    fireEvent.click(screen.getByRole("button", { name: "Retry" }))
    expect(readFile).toHaveBeenCalledTimes(2)
    expect(useStore.getState().loadError?.path).toBe("/vault/retry.md")

    retryRead.resolve("# Recovered")
    await waitFor(() => expect(useStore.getState().loadError).toBeNull())
    expect(useStore.getState().openDoc?.text).toBe("# Recovered")
  })

  it("clears a stale read error when selection moves to a directory", async () => {
    readFile.mockRejectedValue(new Error("missing file"))
    useStore.setState({
      selectedPath: "/vault/missing.md",
      selectedPaths: new Set(["/vault/missing.md"]),
      tree: {
        kind: "dir",
        name: "vault",
        path: "/vault",
        children: [{ kind: "dir", name: "notes", path: "/vault/notes", children: [] }],
      },
    })
    render(<Harness />)
    await screen.findByRole("alert")

    act(() => {
      useStore.getState().setSelected("/vault/notes")
    })

    await waitFor(() => expect(useStore.getState().loadError).toBeNull())
    expect(readFile).toHaveBeenCalledTimes(1)
  })

  it("flushes the dirty note before reading the selected replacement", async () => {
    const order: string[] = []
    useStore.getState().openAnalyzedDocument("/vault/a.md", "A", "disk")
    useStore.getState().editOpenDoc("dirty A")
    saveHarness.flushOpenDocSave.mockImplementation(async () => {
      order.push("flush")
      useStore.getState().patchOpenDoc({ dirty: false, saveStatus: "clean" })
    })
    readFile.mockImplementation(async () => {
      order.push("read")
      return "B"
    })
    useStore.getState().setSelected("/vault/b.md")

    render(<Harness />)

    await waitFor(() => expect(useStore.getState().openDoc?.path).toBe("/vault/b.md"))
    expect(order).toEqual(["flush", "read"])
    expect(saveHarness.flushOpenDocSave).toHaveBeenCalledWith("/vault/a.md")
  })

  it("cancels navigation and restores the old selection when flushing fails", async () => {
    useStore.getState().openAnalyzedDocument("/vault/a.md", "A", "disk")
    useStore.getState().editOpenDoc("dirty A")
    useStore.getState().patchOpenDoc({ saveStatus: "error", saveError: "disk full" })
    saveHarness.flushOpenDocSave.mockRejectedValue(new Error("disk full"))
    useStore.getState().setSelected("/vault/b.md")

    render(<Harness />)

    await waitFor(() => expect(useStore.getState().selectedPath).toBe("/vault/a.md"))
    expect(readFile).not.toHaveBeenCalled()
    expect(useStore.getState().openDoc).toMatchObject({
      path: "/vault/a.md",
      text: "dirty A",
      saveError: "disk full",
    })
  })

  it("flushes an edit made while the next file is being read before replacing it", async () => {
    const nextRead = deferred<string>()
    const finalFlush = deferred<void>()
    useStore.getState().openAnalyzedDocument("/vault/a.md", "A", "disk")
    useStore.getState().editOpenDoc("first A")
    saveHarness.flushOpenDocSave
      .mockImplementationOnce(async () => {
        useStore.getState().patchOpenDoc({ dirty: false, saveStatus: "clean" })
      })
      .mockReturnValueOnce(finalFlush.promise)
    readFile.mockReturnValue(nextRead.promise)
    useStore.getState().setSelected("/vault/b.md")

    render(<Harness />)
    await waitFor(() => expect(readFile).toHaveBeenCalledWith("/vault/b.md"))

    act(() => useStore.getState().editOpenDoc("latest A"))
    nextRead.resolve("B")
    await waitFor(() => expect(saveHarness.flushOpenDocSave).toHaveBeenCalledTimes(2))
    expect(useStore.getState().openDoc?.path).toBe("/vault/a.md")

    finalFlush.resolve()
    await waitFor(() => expect(useStore.getState().openDoc?.path).toBe("/vault/b.md"))
  })

  it("follows a renamed source when an edit lands during the replacement read", async () => {
    const nextRead = deferred<string>()
    useStore.getState().openAnalyzedDocument("/vault/old.md", "A", "disk")
    useStore.getState().editOpenDoc("first A")
    saveHarness.flushOpenDocSave
      .mockImplementationOnce(async () => {
        useStore.getState().patchOpenDoc({
          path: "/vault/renamed.md",
          dirty: false,
          saveStatus: "clean",
        })
      })
      .mockResolvedValueOnce(undefined)
    readFile.mockReturnValue(nextRead.promise)
    useStore.getState().setSelected("/vault/b.md")

    render(<Harness />)
    await waitFor(() => expect(readFile).toHaveBeenCalledWith("/vault/b.md"))

    act(() => useStore.getState().editOpenDoc("latest renamed A"))
    nextRead.resolve("B")

    await waitFor(() => expect(useStore.getState().openDoc?.path).toBe("/vault/b.md"))
    expect(saveHarness.flushOpenDocSave).toHaveBeenNthCalledWith(
      2,
      "/vault/renamed.md",
    )
  })

  it("flushes before closing but ignores directory selections", async () => {
    useStore.getState().openAnalyzedDocument("/vault/a.md", "A", "disk")
    useStore.getState().editOpenDoc("dirty A")
    useStore.getState().setSelected("/vault/a.md")
    useStore.setState({
      tree: {
        kind: "dir",
        name: "vault",
        path: "/vault",
        children: [{ kind: "dir", name: "notes", path: "/vault/notes", children: [] }],
      },
    })
    const { rerender } = render(<Harness />)

    act(() => useStore.getState().setSelected("/vault/notes"))
    rerender(<Harness />)
    await waitFor(() => expect(useStore.getState().selectedPath).toBe("/vault/notes"))
    expect(saveHarness.flushOpenDocSave).not.toHaveBeenCalled()
    expect(useStore.getState().openDoc?.path).toBe("/vault/a.md")

    act(() => useStore.getState().setSelected(null))
    await waitFor(() => expect(useStore.getState().openDoc).toBeNull())
    expect(saveHarness.flushOpenDocSave).toHaveBeenCalledWith("/vault/a.md")
  })

  it("does not let a stale intermediate read replace a newer selection", async () => {
    const b = deferred<string>()
    readFile.mockImplementation((path) => path === "/vault/b.md" ? b.promise : Promise.resolve("C"))
    useStore.getState().openAnalyzedDocument("/vault/a.md", "A", "disk")
    useStore.getState().setSelected("/vault/b.md")
    render(<Harness />)
    await waitFor(() => expect(readFile).toHaveBeenCalledWith("/vault/b.md"))

    act(() => useStore.getState().setSelected("/vault/c.md"))
    await waitFor(() => expect(useStore.getState().openDoc?.path).toBe("/vault/c.md"))
    b.resolve("B")
    await act(async () => { await Promise.resolve() })

    expect(useStore.getState().openDoc?.path).toBe("/vault/c.md")
  })
})
