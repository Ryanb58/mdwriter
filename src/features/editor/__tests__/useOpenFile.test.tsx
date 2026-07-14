import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../../lib/ipc", () => ({
  ipc: {
    readFile: vi.fn(),
  },
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
})
