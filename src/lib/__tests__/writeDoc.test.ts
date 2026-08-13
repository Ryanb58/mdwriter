import { beforeEach, afterEach, describe, expect, it, vi } from "vitest"

const harness = vi.hoisted(() => ({
  writeFile: vi.fn(),
  readFile: vi.fn(),
  noteSelfWrite: vi.fn(),
  showToast: vi.fn(),
}))

// Only `ipc` itself is stubbed. `saveConflictDetail` is the real recognizer:
// the shape it decodes is the Rust `AppError` wire format, and a hand-rolled
// double here would let the two drift apart silently.
vi.mock("../ipc", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../ipc")>()
  return {
    ...actual,
    ipc: { writeFile: harness.writeFile, readFile: harness.readFile },
  }
})
vi.mock("../../features/watcher/useExternalChanges", () => ({
  noteSelfWrite: harness.noteSelfWrite,
}))
vi.mock("../toast", () => ({ showToast: harness.showToast }))

import { useStore } from "../store"
import {
  beginOpenDocPathMutation,
  cancelQueuedOpenDocSave,
  dismissConflictDialog,
  flushOpenDocSave,
  overwriteWithLocalVersion,
  reloadDiscardingLocalChanges,
  reopenConflictDialog,
  resetSaveCoordinatorForTests,
  retryOpenDocSave,
  scheduleOpenDocSave,
} from "../writeDoc"

type Deferred<T> = {
  promise: Promise<T>
  resolve(value: T): void
  reject(reason: unknown): void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function open(path = "/vault/note.md", text = "initial", digest: string | null = null) {
  useStore.getState().openAnalyzedDocument(path, text, "disk", digest)
}

/** The rejection Tauri delivers for Rust's `AppError::SaveConflict`. */
function conflictError(
  path = "/vault/note.md",
  expectedDigest = "disk-v1",
  actualDigest = "disk-v2",
) {
  return { kind: "SaveConflict", message: { path, expectedDigest, actualDigest } }
}

function edit(text: string, path = "/vault/note.md") {
  useStore.getState().editOpenDoc(text)
  scheduleOpenDocSave({ path, text })
}

async function tick() {
  await Promise.resolve()
  await Promise.resolve()
}

describe("open-document save coordinator", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetSaveCoordinatorForTests()
    harness.writeFile.mockReset()
    harness.noteSelfWrite.mockReset()
    harness.showToast.mockReset()
    useStore.setState({ openDoc: null })
  })

  afterEach(() => {
    resetSaveCoordinatorForTests()
    vi.useRealTimers()
  })

  it("moves a normal edit from queued to saving to clean", async () => {
    const write = deferred<void>()
    harness.writeFile.mockReturnValue(write.promise)
    open()

    edit("first edit")
    expect(useStore.getState().openDoc?.saveStatus).toBe("queued")

    await vi.advanceTimersByTimeAsync(500)
    expect(harness.writeFile).toHaveBeenCalledWith("/vault/note.md", "first edit", null)
    expect(useStore.getState().openDoc?.saveStatus).toBe("saving")

    write.resolve()
    await tick()
    expect(useStore.getState().openDoc).toMatchObject({
      dirty: false,
      saveStatus: "clean",
      saveError: null,
    })
    expect(useStore.getState().openDoc?.savedAt).toEqual(expect.any(Number))
  })

  it("coalesces edits during a write and never overlaps writes", async () => {
    const first = deferred<void>()
    const second = deferred<void>()
    harness.writeFile
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    open()

    edit("one")
    await vi.advanceTimersByTimeAsync(500)
    edit("two")
    edit("three")
    await vi.advanceTimersByTimeAsync(500)

    expect(harness.writeFile).toHaveBeenCalledTimes(1)
    first.resolve()
    await tick()
    expect(harness.writeFile).toHaveBeenCalledTimes(2)
    expect(harness.writeFile).toHaveBeenLastCalledWith("/vault/note.md", "three", null)

    second.resolve()
    await tick()
    expect(useStore.getState().openDoc?.saveStatus).toBe("clean")
  })

  it("does not let an old success clear newer dirty text", async () => {
    const first = deferred<void>()
    harness.writeFile.mockReturnValue(first.promise)
    open()

    edit("one")
    await vi.advanceTimersByTimeAsync(500)
    edit("two")
    first.resolve()
    await tick()

    expect(useStore.getState().openDoc).toMatchObject({
      text: "two",
      dirty: true,
      saveStatus: "queued",
    })
  })

  it("keeps an error persistent, stops advancement, and retries the latest snapshot", async () => {
    const first = deferred<void>()
    const retry = deferred<void>()
    harness.writeFile
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(retry.promise)
    open()

    edit("failed snapshot")
    await vi.advanceTimersByTimeAsync(500)
    edit("latest snapshot")
    await vi.advanceTimersByTimeAsync(500)
    first.reject(new Error("Disk full\nwith noisy details"))
    await tick()

    expect(harness.writeFile).toHaveBeenCalledTimes(1)
    expect(useStore.getState().openDoc).toMatchObject({
      dirty: true,
      saveStatus: "error",
      saveError: "Disk full with noisy details",
    })

    const retrying = retryOpenDocSave()
    await tick()
    expect(harness.writeFile).toHaveBeenCalledTimes(2)
    expect(harness.writeFile).toHaveBeenLastCalledWith(
      "/vault/note.md",
      "latest snapshot",
      null,
    )
    retry.resolve()
    await retrying
    expect(useStore.getState().openDoc?.saveStatus).toBe("clean")
  })

  it("starts a fresh debounce when the user edits after a failure", async () => {
    harness.writeFile
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(undefined)
    open()
    edit("one")
    await vi.advanceTimersByTimeAsync(500)
    await tick()
    expect(useStore.getState().openDoc?.saveStatus).toBe("error")

    edit("two")
    expect(useStore.getState().openDoc).toMatchObject({
      saveStatus: "queued",
      saveError: null,
    })
    await vi.advanceTimersByTimeAsync(499)
    expect(harness.writeFile).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    await tick()
    expect(harness.writeFile).toHaveBeenCalledTimes(2)
  })

  it("flushes a newer post-error edit even before the autosave effect schedules it", async () => {
    harness.writeFile
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(undefined)
    open()
    edit("failed bytes")
    await expect(flushOpenDocSave()).rejects.toThrow("offline")

    useStore.getState().editOpenDoc("newer unscheduled bytes")
    await flushOpenDocSave()

    expect(harness.writeFile).toHaveBeenLastCalledWith(
      "/vault/note.md",
      "newer unscheduled bytes",
      null,
    )
    expect(useStore.getState().openDoc?.saveStatus).toBe("clean")
  })

  it("flushes queued work immediately and waits for active work", async () => {
    const write = deferred<void>()
    harness.writeFile.mockReturnValue(write.promise)
    open()
    edit("flush me")

    let settled = false
    const flushing = flushOpenDocSave().then(() => { settled = true })
    await tick()
    expect(harness.writeFile).toHaveBeenCalledWith("/vault/note.md", "flush me", null)
    expect(settled).toBe(false)

    write.resolve()
    await flushing
    expect(settled).toBe(true)
  })

  it("captures dirty store bytes when flush wins the race with the autosave effect", async () => {
    harness.writeFile.mockResolvedValue(undefined)
    open()
    useStore.getState().editOpenDoc("latest unscheduled edit")

    await flushOpenDocSave()

    expect(harness.writeFile).toHaveBeenCalledWith(
      "/vault/note.md",
      "latest unscheduled edit",
      null,
    )
    expect(useStore.getState().openDoc?.saveStatus).toBe("clean")
  })

  it("rejects flush on failure and preserves the error state", async () => {
    harness.writeFile.mockRejectedValue(new Error("permission denied"))
    open()
    edit("cannot save")

    await expect(flushOpenDocSave()).rejects.toThrow("permission denied")
    expect(useStore.getState().openDoc).toMatchObject({
      dirty: true,
      saveStatus: "error",
      saveError: "permission denied",
    })
  })

  it("treats non-Error rejection values as failed writes", async () => {
    harness.writeFile.mockRejectedValue(null)
    open()
    edit("cannot save")

    await expect(flushOpenDocSave()).rejects.toBeNull()
    expect(useStore.getState().openDoc).toMatchObject({
      dirty: true,
      saveStatus: "error",
      saveError: "Couldn't save this note.",
    })
  })

  it("cancels only queued work and lets an active write finish", async () => {
    const active = deferred<void>()
    harness.writeFile.mockReturnValue(active.promise)
    open()
    edit("active")
    await vi.advanceTimersByTimeAsync(500)
    edit("cancel this")
    await vi.advanceTimersByTimeAsync(500)

    cancelQueuedOpenDocSave("/vault/note.md")
    active.resolve()
    await tick()

    expect(harness.writeFile).toHaveBeenCalledTimes(1)
    expect(useStore.getState().openDoc).toMatchObject({
      text: "cancel this",
      dirty: true,
    })
  })

  it("stamps self-writes before and after every IPC attempt", async () => {
    harness.writeFile.mockRejectedValue(new Error("boom"))
    open()
    edit("attempt")

    await expect(flushOpenDocSave()).rejects.toThrow("boom")
    expect(harness.noteSelfWrite.mock.calls).toEqual([
      ["/vault/note.md"],
      ["/vault/note.md"],
    ])
  })

  it("pauses edits behind a path mutation and remaps them before release", async () => {
    const initial = deferred<void>()
    const afterRename = deferred<void>()
    harness.writeFile
      .mockReturnValueOnce(initial.promise)
      .mockReturnValueOnce(afterRename.promise)
    open("/vault/old.md", "before")
    edit("flush before rename", "/vault/old.md")

    const guardPromise = beginOpenDocPathMutation(["/vault/old.md"])
    await tick()
    expect(harness.writeFile).toHaveBeenCalledWith(
      "/vault/old.md",
      "flush before rename",
      null,
    )
    initial.resolve()
    const guard = await guardPromise

    useStore.getState().patchOpenDoc({ path: "/vault/new.md" })
    edit("typed during rename", "/vault/old.md")
    await vi.advanceTimersByTimeAsync(500)
    expect(harness.writeFile).toHaveBeenCalledTimes(1)

    guard.remap("/vault/old.md", "/vault/new.md")
    guard.release()
    await tick()
    expect(harness.writeFile).toHaveBeenCalledTimes(2)
    expect(harness.writeFile).toHaveBeenLastCalledWith(
      "/vault/new.md",
      "typed during rename",
      null,
    )
    afterRename.resolve()
    await tick()
  })

  it("discards queued edits for a path that was removed", async () => {
    harness.writeFile.mockResolvedValue(undefined)
    open("/vault/deleted.md", "before")
    const guard = await beginOpenDocPathMutation(["/vault/deleted.md"])

    useStore.getState().editOpenDoc("typed during delete")
    scheduleOpenDocSave({ path: "/vault/deleted.md", text: "typed during delete" })
    await vi.advanceTimersByTimeAsync(500)
    expect(harness.writeFile).not.toHaveBeenCalled()

    guard.discard(["/vault/deleted.md"])
    guard.release()
    await tick()
    expect(harness.writeFile).not.toHaveBeenCalled()
  })

  it("releases queued edits back to the source after a failed path mutation", async () => {
    harness.writeFile.mockResolvedValue(undefined)
    open("/vault/old.md", "before")
    const guard = await beginOpenDocPathMutation(["/vault/old.md"])

    useStore.getState().editOpenDoc("typed during failed rename")
    scheduleOpenDocSave({
      path: "/vault/old.md",
      text: "typed during failed rename",
    })
    await vi.advanceTimersByTimeAsync(500)
    expect(harness.writeFile).not.toHaveBeenCalled()

    guard.release()
    await tick()
    expect(harness.writeFile).toHaveBeenCalledWith(
      "/vault/old.md",
      "typed during failed rename",
      null,
    )
  })

  it("keeps navigation flushes paused and follows a successful path remap", async () => {
    harness.writeFile.mockResolvedValue(undefined)
    open("/vault/old.md", "before")
    const guard = await beginOpenDocPathMutation(["/vault/old.md"])
    edit("typed during rename", "/vault/old.md")

    let settled = false
    const flushing = flushOpenDocSave("/vault/old.md").then(() => {
      settled = true
    })
    await tick()
    expect(harness.writeFile).not.toHaveBeenCalled()
    expect(settled).toBe(false)

    useStore.getState().patchOpenDoc({ path: "/vault/new.md" })
    guard.remap("/vault/old.md", "/vault/new.md")
    guard.release()
    await flushing

    expect(harness.writeFile).toHaveBeenCalledWith(
      "/vault/new.md",
      "typed during rename",
      null,
    )
    expect(settled).toBe(true)
  })

  it("serializes overlapping path mutations so a later guard cannot bypass the first", async () => {
    harness.writeFile.mockResolvedValue(undefined)
    open("/vault/old.md", "before")
    const firstGuard = await beginOpenDocPathMutation(["/vault/old.md"])

    edit("typed during rename", "/vault/old.md")
    let secondAcquired = false
    const secondGuardPromise = beginOpenDocPathMutation(["/vault/old.md"])
      .then((guard) => {
        secondAcquired = true
        return guard
      })

    await vi.advanceTimersByTimeAsync(500)
    await tick()
    expect(secondAcquired).toBe(false)
    expect(harness.writeFile).not.toHaveBeenCalled()

    useStore.getState().patchOpenDoc({ path: "/vault/new.md" })
    firstGuard.remap("/vault/old.md", "/vault/new.md")
    firstGuard.release()

    const secondGuard = await secondGuardPromise
    expect(harness.writeFile).toHaveBeenCalledWith(
      "/vault/new.md",
      "typed during rename",
      null,
    )
    expect(harness.writeFile).not.toHaveBeenCalledWith(
      "/vault/old.md",
      "typed during rename",
    )
    secondGuard.release()
  })

  it("lets the mutation owner perform its final flush while paused", async () => {
    harness.writeFile.mockResolvedValue(undefined)
    open("/vault/old.md", "before")
    const guard = await beginOpenDocPathMutation(["/vault/old.md"])
    edit("final old-vault bytes", "/vault/old.md")

    await guard.flush("/vault/old.md")

    expect(harness.writeFile).toHaveBeenCalledWith(
      "/vault/old.md",
      "final old-vault bytes",
      null,
    )
    guard.release()
  })

  it("does not strand a queued path when an earlier path fails", async () => {
    const first = deferred<void>()
    harness.writeFile
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(undefined)

    open("/vault/a.md", "a")
    edit("save a", "/vault/a.md")
    await vi.advanceTimersByTimeAsync(500)

    open("/vault/b.md", "b")
    edit("save b", "/vault/b.md")
    const flushingB = flushOpenDocSave("/vault/b.md")
    await tick()
    expect(harness.writeFile).toHaveBeenCalledTimes(1)

    first.reject(new Error("A failed"))
    await tick()

    expect(harness.writeFile).toHaveBeenCalledTimes(2)
    expect(harness.writeFile).toHaveBeenLastCalledWith("/vault/b.md", "save b", null)
    await expect(flushingB).resolves.toBeUndefined()
    await expect(flushOpenDocSave()).resolves.toBeUndefined()
  })

  it("waits for an affected active snapshot even if another document is current", async () => {
    const first = deferred<void>()
    harness.writeFile.mockReturnValue(first.promise)
    open("/vault/a.md", "a")
    edit("active a", "/vault/a.md")
    await vi.advanceTimersByTimeAsync(500)

    open("/vault/b.md", "b")
    let acquired = false
    const acquiring = beginOpenDocPathMutation(["/vault/a.md"])
      .then((guard) => {
        acquired = true
        return guard
      })
    await tick()
    expect(acquired).toBe(false)

    first.resolve()
    const guard = await acquiring
    expect(acquired).toBe(true)
    guard.release()
  })

  it("flushes affected queued snapshots even if another document is current", async () => {
    harness.writeFile.mockResolvedValue(undefined)
    open("/vault/a.md", "a")
    edit("queued a", "/vault/a.md")
    open("/vault/b.md", "b")

    const guard = await beginOpenDocPathMutation(["/vault/a.md"])

    expect(harness.writeFile).toHaveBeenCalledWith("/vault/a.md", "queued a", null)
    guard.release()
  })

  it("treats a filesystem root as an ancestor mutation", async () => {
    harness.writeFile.mockResolvedValue(undefined)
    open("/note.md", "before")
    edit("root edit", "/note.md")

    const guard = await beginOpenDocPathMutation(["/"])

    expect(harness.writeFile).toHaveBeenCalledWith("/note.md", "root edit", null)
    guard.release()
  })

  // --- Cross-window conflict (reference behavior S2.3 / S2.4 / S2.5) -------

  it("sends the digest it last read as the save precondition", async () => {
    harness.writeFile.mockResolvedValue("disk-v2")
    open("/vault/note.md", "initial", "disk-v1")

    edit("first edit")
    await vi.advanceTimersByTimeAsync(500)

    expect(harness.writeFile).toHaveBeenCalledWith("/vault/note.md", "first edit", "disk-v1")
  })

  it("carries the digest a save returned into the next save", async () => {
    // Otherwise the second save asserts a precondition this window itself
    // invalidated, and every window would conflict with its own last write.
    harness.writeFile.mockResolvedValueOnce("disk-v2").mockResolvedValueOnce("disk-v3")
    open("/vault/note.md", "initial", "disk-v1")

    edit("first edit")
    await vi.advanceTimersByTimeAsync(500)
    await tick()
    expect(useStore.getState().openDoc?.diskDigest).toBe("disk-v2")

    edit("second edit")
    await vi.advanceTimersByTimeAsync(500)
    expect(harness.writeFile).toHaveBeenLastCalledWith(
      "/vault/note.md",
      "second edit",
      "disk-v2",
    )
  })

  it("blocks a save that lost the race and keeps the user's buffer", async () => {
    // S2.3: another window wrote the file after this one read it. The refusal
    // must not read as a generic failure, and it must not cost the user a byte.
    harness.writeFile.mockRejectedValue(conflictError())
    open("/vault/note.md", "initial", "disk-v1")

    edit("my unsaved work")
    await vi.advanceTimersByTimeAsync(500)
    await tick()

    expect(useStore.getState().openDoc).toMatchObject({
      text: "my unsaved work",
      dirty: true,
      saveStatus: "conflict",
    })
    expect(useStore.getState().saveConflict).toEqual({
      path: "/vault/note.md",
      expectedDigest: "disk-v1",
      actualDigest: "disk-v2",
      dismissed: false,
    })
    // A conflict is its own surface, not a toast that scrolls away.
    expect(harness.showToast).not.toHaveBeenCalled()
  })

  it("does not spin retrying a blocked save while the user keeps typing", async () => {
    // Autosave fires on every debounce. Re-attempting the same precondition
    // against the same disk fails identically, so it must stay parked.
    harness.writeFile.mockRejectedValue(conflictError())
    open("/vault/note.md", "initial", "disk-v1")
    edit("my unsaved work")
    await vi.advanceTimersByTimeAsync(500)
    await tick()
    expect(harness.writeFile).toHaveBeenCalledTimes(1)

    edit("more typing")
    await vi.advanceTimersByTimeAsync(2000)
    await tick()
    edit("even more typing")
    await vi.advanceTimersByTimeAsync(2000)
    await tick()

    expect(harness.writeFile).toHaveBeenCalledTimes(1)
    expect(useStore.getState().openDoc).toMatchObject({
      text: "even more typing",
      dirty: true,
      saveStatus: "conflict",
    })
  })

  it("never marks a blocked document clean", async () => {
    harness.writeFile.mockRejectedValue(conflictError())
    open("/vault/note.md", "initial", "disk-v1")
    edit("my unsaved work")
    await vi.advanceTimersByTimeAsync(500)
    await tick()

    await expect(flushOpenDocSave()).rejects.toMatchObject({ kind: "SaveConflict" })
    expect(useStore.getState().openDoc?.dirty).toBe(true)
    expect(useStore.getState().openDoc?.savedAt).toBeNull()
  })

  it("resolves a conflict by overwriting with the local version", async () => {
    // S2.4 "Overwrite": the user has seen the conflict and chosen. The write
    // goes out with no precondition and re-establishes a fresh digest.
    harness.writeFile.mockRejectedValueOnce(conflictError()).mockResolvedValueOnce("disk-v3")
    open("/vault/note.md", "initial", "disk-v1")
    edit("my unsaved work")
    await vi.advanceTimersByTimeAsync(500)
    await tick()

    await overwriteWithLocalVersion()

    expect(harness.writeFile).toHaveBeenLastCalledWith(
      "/vault/note.md",
      "my unsaved work",
      null,
    )
    expect(useStore.getState().saveConflict).toBeNull()
    expect(useStore.getState().openDoc).toMatchObject({
      text: "my unsaved work",
      dirty: false,
      saveStatus: "clean",
      diskDigest: "disk-v3",
    })
  })

  it("overwrites the newest bytes, not the ones that were refused", async () => {
    harness.writeFile.mockRejectedValueOnce(conflictError()).mockResolvedValueOnce("disk-v3")
    open("/vault/note.md", "initial", "disk-v1")
    edit("refused bytes")
    await vi.advanceTimersByTimeAsync(500)
    await tick()

    edit("bytes typed while deciding")
    await overwriteWithLocalVersion()

    expect(harness.writeFile).toHaveBeenLastCalledWith(
      "/vault/note.md",
      "bytes typed while deciding",
      null,
    )
  })

  it("resolves a conflict by discarding the local version and reloading", async () => {
    harness.writeFile.mockRejectedValue(conflictError())
    harness.readFile.mockResolvedValue({ text: "the other window's work", digest: "disk-v2" })
    open("/vault/note.md", "initial", "disk-v1")
    edit("my unsaved work")
    await vi.advanceTimersByTimeAsync(500)
    await tick()

    await reloadDiscardingLocalChanges()

    expect(useStore.getState().saveConflict).toBeNull()
    expect(useStore.getState().openDoc).toMatchObject({
      text: "the other window's work",
      dirty: false,
      saveStatus: "clean",
      diskDigest: "disk-v2",
    })
    // Resolving one way must not smuggle the discarded bytes out the other.
    expect(harness.writeFile).toHaveBeenCalledTimes(1)
  })

  it("leaves the conflict standing when the reload itself fails", async () => {
    harness.writeFile.mockRejectedValue(conflictError())
    harness.readFile.mockRejectedValue(new Error("permission denied"))
    open("/vault/note.md", "initial", "disk-v1")
    edit("my unsaved work")
    await vi.advanceTimersByTimeAsync(500)
    await tick()

    await expect(reloadDiscardingLocalChanges()).rejects.toThrow("permission denied")

    expect(useStore.getState().saveConflict?.path).toBe("/vault/note.md")
    expect(useStore.getState().openDoc).toMatchObject({
      text: "my unsaved work",
      dirty: true,
      saveStatus: "conflict",
    })
  })

  it("keeps saving parked while the dialog is only dismissed", async () => {
    harness.writeFile.mockRejectedValue(conflictError())
    open("/vault/note.md", "initial", "disk-v1")
    edit("my unsaved work")
    await vi.advanceTimersByTimeAsync(500)
    await tick()

    dismissConflictDialog()
    expect(useStore.getState().saveConflict?.dismissed).toBe(true)

    edit("still typing")
    await vi.advanceTimersByTimeAsync(2000)
    await tick()
    expect(harness.writeFile).toHaveBeenCalledTimes(1)
    expect(useStore.getState().openDoc?.saveStatus).toBe("conflict")

    reopenConflictDialog()
    expect(useStore.getState().saveConflict?.dismissed).toBe(false)
  })

  it("clears a conflict when the document is reloaded from disk by anything else", async () => {
    // The watcher reloading a now-clean buffer (S2.1) is itself a resolution:
    // buffer and disk agree again, so a stale prompt would be a lie.
    harness.writeFile.mockRejectedValue(conflictError())
    open("/vault/note.md", "initial", "disk-v1")
    edit("my unsaved work")
    await vi.advanceTimersByTimeAsync(500)
    await tick()
    expect(useStore.getState().saveConflict).not.toBeNull()

    useStore.getState().openAnalyzedDocument(
      "/vault/note.md",
      "reloaded from disk",
      "external",
      "disk-v2",
    )
    expect(useStore.getState().saveConflict).toBeNull()
  })
})
