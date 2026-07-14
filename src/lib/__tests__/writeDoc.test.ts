import { beforeEach, afterEach, describe, expect, it, vi } from "vitest"

const harness = vi.hoisted(() => ({
  writeFile: vi.fn(),
  noteSelfWrite: vi.fn(),
  showToast: vi.fn(),
}))

vi.mock("../ipc", () => ({
  ipc: { writeFile: harness.writeFile },
}))
vi.mock("../../features/watcher/useExternalChanges", () => ({
  noteSelfWrite: harness.noteSelfWrite,
}))
vi.mock("../toast", () => ({ showToast: harness.showToast }))

import { useStore } from "../store"
import {
  beginOpenDocPathMutation,
  cancelQueuedOpenDocSave,
  flushOpenDocSave,
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

function open(path = "/vault/note.md", text = "initial") {
  useStore.getState().openAnalyzedDocument(path, text, "disk")
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
    expect(harness.writeFile).toHaveBeenCalledWith("/vault/note.md", "first edit")
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
    expect(harness.writeFile).toHaveBeenLastCalledWith("/vault/note.md", "three")

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
    expect(harness.writeFile).toHaveBeenCalledWith("/vault/note.md", "flush me")
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
})
