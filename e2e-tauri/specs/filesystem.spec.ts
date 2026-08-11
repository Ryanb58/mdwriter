import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { expect } from "@wdio/globals"
import { createTempVault } from "../helpers/tempVault"
import { invoke } from "../helpers/ipc"

type TreeNode = {
  kind: "dir" | "file"
  name: string
  path: string
  children?: TreeNode[]
  loaded?: boolean
}

type InvokeError = {
  kind?: string
  message?: string
}

describe("Tauri filesystem IPC", () => {
  let vault: ReturnType<typeof createTempVault>
  let outside: ReturnType<typeof createTempVault>

  beforeEach(() => {
    vault = createTempVault()
    outside = createTempVault()

    mkdirSync(join(vault.root, "notes"))
    writeFileSync(join(vault.root, "intro.md"), "# Intro\n")
    writeFileSync(join(vault.root, "guide.markdown"), "# Guide\n")
    writeFileSync(join(vault.root, "ignored.txt"), "ignore me")
    writeFileSync(join(vault.root, "image.png"), "not a real image")
    writeFileSync(join(vault.root, ".hidden.md"), "# Hidden\n")
    writeFileSync(join(vault.root, "notes", "nested.md"), "# Nested\n")
    writeFileSync(join(vault.root, "notes", "nested.txt"), "ignore me")
  })

  afterEach(() => {
    vault.cleanup()
    outside.cleanup()
  })

  it("lists only shallow markdown files and directories", async () => {
    const tree = await invoke<TreeNode>("list_tree", {
      root: vault.root,
      options: {},
    })

    expect(tree).toMatchObject({ kind: "dir", loaded: true })
    expect(tree.children?.map(({ name }) => name)).toEqual([
      "notes",
      "guide.markdown",
      "intro.md",
    ])

    const notes = await invoke<TreeNode>("list_directory", {
      path: join(vault.root, "notes"),
      options: {},
    })

    expect(notes).toMatchObject({ kind: "dir", loaded: true })
    expect(notes.children?.map(({ name }) => name)).toEqual(["nested.md"])
  })

  it("writes and reads an in-scope file through IPC", async () => {
    await invoke("list_tree", { root: vault.root, options: {} })

    const note = join(vault.root, "created.md")
    await invoke("create_file", { path: note })
    await invoke("write_file", { path: note, text: "# Written through IPC\n" })

    expect(await invoke("read_file", { path: note })).toBe("# Written through IPC\n")
    expect(readFileSync(note, "utf8")).toBe("# Written through IPC\n")
  })

  it("rejects writes outside the active vault with InvalidPath", async () => {
    await invoke("list_tree", { root: vault.root, options: {} })

    const forbidden = join(outside.root, "forbidden.md")
    const error = await browser.tauri.execute(async ({ core }, path) => {
      try {
        await core.invoke("write_file", { path, text: "no" })
      } catch (error) {
        const value = error as InvokeError
        return { kind: value.kind, message: value.message }
      }

      throw new Error("outside-scope write unexpectedly succeeded")
    }, forbidden)

    expect(error).toMatchObject({ kind: "InvalidPath" })
    expect(existsSync(forbidden)).toBe(false)
  })

  it("stores the current vault first in recent folders", async () => {
    await invoke("push_recent_folder", { folder: vault.root })

    const recent = await invoke<string[]>("get_recent_folders")

    expect(recent[0]).toBe(vault.root)
  })
})
