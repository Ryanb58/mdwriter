import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}))

import { invoke } from "@tauri-apps/api/core"
import { createNewFile } from "../useTreeActions"
import { useStore } from "../../../lib/store"

const minimalTree = { kind: "dir" as const, name: "vault", path: "/vault", children: [] }

function mockInvoke(handler: (cmd: string, args: unknown) => unknown) {
  vi.mocked(invoke).mockImplementation(((cmd: string, args?: unknown) =>
    Promise.resolve(handler(cmd, args))) as typeof invoke)
}

describe("createNewFile", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset()
    useStore.setState({ tree: null, rootPath: "/vault", selectedPath: null })
  })

  it("creates an untitled.md on a clean parent", async () => {
    const calls: string[] = []
    mockInvoke((cmd, args) => {
      if (cmd === "create_file") calls.push((args as { path: string }).path)
      if (cmd === "list_tree") return minimalTree
      return undefined
    })
    await createNewFile("/vault")
    expect(calls).toEqual(["/vault/untitled.md"])
    expect(useStore.getState().selectedPath).toBe("/vault/untitled.md")
  })

  it("retries with numbered suffixes only on collision", async () => {
    let n = 0
    const calls: string[] = []
    mockInvoke((cmd, args) => {
      if (cmd === "create_file") {
        const p = (args as { path: string }).path
        calls.push(p)
        n += 1
        if (n <= 2) throw { kind: "Io", message: `already exists: ${p}` }
        return undefined
      }
      if (cmd === "list_tree") return minimalTree
      return undefined
    })
    await createNewFile("/vault")
    expect(calls).toEqual([
      "/vault/untitled.md",
      "/vault/untitled 2.md",
      "/vault/untitled 3.md",
    ])
    expect(useStore.getState().selectedPath).toBe("/vault/untitled 3.md")
  })

  it("does not retry on non-collision errors (permission, missing parent, …)", async () => {
    let createCalls = 0
    mockInvoke((cmd) => {
      if (cmd === "create_file") {
        createCalls += 1
        throw { kind: "Io", message: "permission denied: /vault" }
      }
      return undefined
    })
    await expect(createNewFile("/vault")).rejects.toMatchObject({
      message: expect.stringContaining("permission denied"),
    })
    expect(createCalls).toBe(1)
  })
})
