import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const retryOpenDocSave = vi.hoisted(() => vi.fn(() => Promise.resolve()))

vi.mock("../../../lib/writeDoc", () => ({ retryOpenDocSave }))
vi.mock("../../vaults/VaultPicker", () => ({ VaultPicker: () => <span>Vault</span> }))
vi.mock("../../ai/AgentPicker", () => ({ AgentPicker: () => <span>Agent</span> }))

import { useStore } from "../../../lib/store"
import { StatusBar } from "../StatusBar"

function seed(status: "clean" | "queued" | "saving" | "error", savedAt: number | null = null) {
  useStore.getState().openAnalyzedDocument("/vault/note.md", "note", "disk")
  useStore.getState().patchOpenDoc({
    dirty: status !== "clean",
    saveStatus: status,
    saveError: status === "error" ? "disk full" : null,
    savedAt,
  })
}

describe("StatusBar save lifecycle", () => {
  beforeEach(() => {
    retryOpenDocSave.mockClear()
    useStore.setState({ openDoc: null })
  })

  it("shows Unsaved without a spinner while debounce work is queued", () => {
    seed("queued")
    render(<StatusBar />)

    expect(screen.getByText("Unsaved")).toBeInTheDocument()
    expect(screen.queryByTestId("save-spinner")).not.toBeInTheDocument()
  })

  it("shows a spinner and Saving… only while IPC is active", () => {
    seed("saving")
    render(<StatusBar />)

    expect(screen.getByText("Saving…")).toBeInTheDocument()
    expect(screen.getByTestId("save-spinner")).toHaveClass("animate-spin")
  })

  it("keeps the existing timestamped Saved presentation for clean notes", () => {
    seed("clean", new Date("2026-07-14T12:34:00").getTime())
    render(<StatusBar />)

    expect(screen.getByText(/Saved 12:34 PM/)).toBeInTheDocument()
  })

  it("persists Save failed and offers an immediate Retry", () => {
    seed("error")
    render(<StatusBar />)

    expect(screen.getByText("Save failed")).toBeInTheDocument()
    const retry = screen.getByRole("button", { name: "Retry save" })
    expect(retry).toBeEnabled()
    fireEvent.click(retry)
    expect(retryOpenDocSave).toHaveBeenCalledTimes(1)
  })

  it("disables Retry while a save is active", () => {
    seed("saving")
    render(<StatusBar />)

    expect(screen.queryByRole("button", { name: "Retry save" })).not.toBeInTheDocument()
  })
})
