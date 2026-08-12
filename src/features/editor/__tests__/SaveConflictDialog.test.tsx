import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const harness = vi.hoisted(() => ({
  overwriteWithLocalVersion: vi.fn(),
  reloadDiscardingLocalChanges: vi.fn(),
  showToast: vi.fn(),
}))

// The coordinator's own behavior is covered in writeDoc.test.ts. What is under
// test here is the wiring the coordinator tests cannot see: that each button
// reaches the resolution it claims to, that a failed resolution leaves the
// conflict live, and that dismissing does not silently resolve anything.
vi.mock("../../../lib/writeDoc", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/writeDoc")>()
  return {
    ...actual,
    overwriteWithLocalVersion: harness.overwriteWithLocalVersion,
    reloadDiscardingLocalChanges: harness.reloadDiscardingLocalChanges,
  }
})
vi.mock("../../../lib/toast", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/toast")>()
  return { ...actual, showToast: harness.showToast }
})

import { useStore } from "../../../lib/store"
import { SaveConflictDialog } from "../SaveConflictDialog"

const CONFLICT = {
  path: "/vault/note.md",
  expectedDigest: "disk-v1",
  actualDigest: "disk-v2",
  dismissed: false,
}

describe("SaveConflictDialog", () => {
  beforeEach(() => {
    harness.overwriteWithLocalVersion.mockReset().mockResolvedValue(undefined)
    harness.reloadDiscardingLocalChanges.mockReset().mockResolvedValue(undefined)
    harness.showToast.mockReset()
    useStore.setState({ openDoc: null, saveConflict: null })
  })

  it("stays out of the way until there is a conflict", () => {
    render(<SaveConflictDialog />)
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("names the file whose save was refused", () => {
    useStore.getState().setSaveConflict(CONFLICT)
    render(<SaveConflictDialog />)

    expect(screen.getByRole("dialog")).toBeInTheDocument()
    expect(screen.getByText(/note\.md/)).toBeInTheDocument()
    // S2.5: the user is told, in the dialog itself, that nothing was lost.
    expect(screen.getByText(/nothing has been overwritten/i)).toBeInTheDocument()
  })

  it("offers both directions of the decision (S2.4/S2.5)", () => {
    useStore.getState().setSaveConflict(CONFLICT)
    render(<SaveConflictDialog />)

    expect(screen.getByRole("button", { name: /overwrite with mine/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /discard mine, reload/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /keep editing/i })).toBeInTheDocument()
  })

  it("routes Overwrite to the keep-my-version resolution", async () => {
    useStore.getState().setSaveConflict(CONFLICT)
    render(<SaveConflictDialog />)

    fireEvent.click(screen.getByRole("button", { name: /overwrite with mine/i }))

    await waitFor(() => expect(harness.overwriteWithLocalVersion).toHaveBeenCalledTimes(1))
    expect(harness.reloadDiscardingLocalChanges).not.toHaveBeenCalled()
  })

  it("routes Discard to the take-disk resolution", async () => {
    useStore.getState().setSaveConflict(CONFLICT)
    render(<SaveConflictDialog />)

    fireEvent.click(screen.getByRole("button", { name: /discard mine, reload/i }))

    await waitFor(() => expect(harness.reloadDiscardingLocalChanges).toHaveBeenCalledTimes(1))
    expect(harness.overwriteWithLocalVersion).not.toHaveBeenCalled()
  })

  it("dismisses without resolving anything", () => {
    useStore.getState().setSaveConflict(CONFLICT)
    render(<SaveConflictDialog />)

    fireEvent.click(screen.getByRole("button", { name: /keep editing/i }))

    // Hidden, but still unresolved — the status bar keeps a way back in.
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(useStore.getState().saveConflict).toMatchObject({ dismissed: true })
    expect(harness.overwriteWithLocalVersion).not.toHaveBeenCalled()
    expect(harness.reloadDiscardingLocalChanges).not.toHaveBeenCalled()
  })

  it("treats Escape as dismiss, not as a resolution", () => {
    useStore.getState().setSaveConflict(CONFLICT)
    render(<SaveConflictDialog />)

    fireEvent.keyDown(document, { key: "Escape" })

    expect(useStore.getState().saveConflict).toMatchObject({ dismissed: true })
    expect(harness.overwriteWithLocalVersion).not.toHaveBeenCalled()
    expect(harness.reloadDiscardingLocalChanges).not.toHaveBeenCalled()
  })

  it("keeps the conflict live when a resolution fails", async () => {
    harness.overwriteWithLocalVersion.mockRejectedValue(new Error("disk full"))
    useStore.getState().setSaveConflict(CONFLICT)
    render(<SaveConflictDialog />)

    fireEvent.click(screen.getByRole("button", { name: /overwrite with mine/i }))

    await waitFor(() => expect(harness.showToast).toHaveBeenCalledTimes(1))
    // The buffer is still parked and the user can pick again — a failed
    // resolution must not read as a resolved one.
    expect(useStore.getState().saveConflict).toMatchObject({ dismissed: false })
    expect(screen.getByRole("dialog")).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /overwrite with mine/i })).toBeEnabled(),
    )
  })

  it("locks every resolution down while one is in flight", async () => {
    // Mutation-checked: the mechanism that actually prevents a second call is
    // the `disabled` attribute (React re-renders before the next click lands),
    // not the `if (busy) return` re-entrancy guard, which is belt-and-braces.
    // So assert the user-visible property — all three buttons inert mid-flight
    // — rather than only the call count, which passes even with the guard gone.
    let release!: () => void
    harness.overwriteWithLocalVersion.mockReturnValue(
      new Promise<void>((resolve) => { release = () => resolve() }),
    )
    useStore.getState().setSaveConflict(CONFLICT)
    render(<SaveConflictDialog />)

    const overwrite = screen.getByRole("button", { name: /overwrite with mine/i })
    fireEvent.click(overwrite)

    await waitFor(() => expect(overwrite).toBeDisabled())
    // Crucially the *other* direction is locked too: clicking Discard while an
    // overwrite is in flight would run both resolutions against one conflict.
    const discard = screen.getByRole("button", { name: /discard mine, reload/i })
    expect(discard).toBeDisabled()
    fireEvent.click(discard)
    expect(harness.reloadDiscardingLocalChanges).not.toHaveBeenCalled()

    fireEvent.click(overwrite)
    expect(harness.overwriteWithLocalVersion).toHaveBeenCalledTimes(1)

    release()
    await waitFor(() => expect(overwrite).toBeEnabled())
  })
})
