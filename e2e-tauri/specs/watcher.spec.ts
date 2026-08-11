import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { browser } from "@wdio/globals"
import { createTempVault } from "../helpers/tempVault"
import { invoke } from "../helpers/ipc"

describe("Tauri vault watcher", () => {
  let vault: ReturnType<typeof createTempVault>
  let watcherStarted = false

  beforeEach(() => {
    vault = createTempVault()
    watcherStarted = false
  })

  afterEach(async () => {
    try {
      await browser.tauri.execute(async () => {
        const stop = window.__mdwriterStopVaultListener
        window.__mdwriterStopVaultListener = undefined
        window.__mdwriterVaultChanges = undefined
        if (stop) await stop()
      })
    } finally {
      try {
        if (watcherStarted) await invoke("stop_watcher")
      } finally {
        vault.cleanup()
      }
    }
  })

  it("delivers a Node file write to the frontend", async () => {
    await invoke("list_tree", { root: vault.root, options: {} })

    await browser.tauri.execute(async () => {
      const event = window.__TAURI__?.event
      if (!event) throw new Error("Tauri event API is unavailable")

      window.__mdwriterVaultChanges = []
      window.__mdwriterStopVaultListener = await event.listen<{ paths: string[] }>(
        "vault-changed",
        ({ payload }) => window.__mdwriterVaultChanges?.push(...payload.paths),
      )
    })

    await invoke("start_watcher", { root: vault.root })
    watcherStarted = true

    const changedPath = join(vault.root, "changed.md")
    let revision = 0

    try {
      await browser.waitUntil(
        async () => {
          writeFileSync(changedPath, `Node edit ${revision++}`)
          return browser.execute(
            (path) => window.__mdwriterVaultChanges?.includes(path) ?? false,
            changedPath,
          )
        },
        { timeout: 10_000, interval: 250 },
      )
    } catch (error) {
      const observedPaths = await browser.execute(
        () => window.__mdwriterVaultChanges ?? [],
      )
      throw new Error(
        `watcher did not emit ${changedPath}; observed paths: ${JSON.stringify(observedPaths)}`,
        { cause: error },
      )
    }
  })
})
