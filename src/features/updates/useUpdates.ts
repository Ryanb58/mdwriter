import { useEffect, useState } from "react"
import { check, type Update } from "@tauri-apps/plugin-updater"
import { relaunch } from "@tauri-apps/plugin-process"
import { listen } from "@tauri-apps/api/event"
import { getVersion } from "@tauri-apps/api/app"

export type UpdateStatus =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "available"; update: Update }
  | { kind: "downloading"; bytes: number; total: number | null }
  | { kind: "ready" }
  | { kind: "current" }
  | { kind: "error"; message: string }

const SILENT_INITIAL_DELAY_MS = 10_000

export function useUpdates() {
  const [status, setStatus] = useState<UpdateStatus>({ kind: "idle" })
  const [appVersion, setAppVersion] = useState<string>("")

  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => {})
  }, [])

  async function runCheck(silent = false) {
    setStatus({ kind: "checking" })
    try {
      const update = await check()
      if (!update) {
        setStatus({ kind: "current" })
        return
      }
      setStatus({ kind: "available", update })
    } catch (e) {
      const msg = String(e)
      // In dev / unsigned local builds the updater can't fetch; stay quiet.
      if (silent) {
        setStatus({ kind: "idle" })
        return
      }
      setStatus({ kind: "error", message: msg })
    }
  }

  async function install() {
    if (status.kind !== "available") return
    const update = status.update
    let bytes = 0
    let total: number | null = null
    setStatus({ kind: "downloading", bytes: 0, total: null })
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? null
        }
        if (event.event === "Progress") {
          bytes += event.data.chunkLength
          setStatus({ kind: "downloading", bytes, total })
        }
        if (event.event === "Finished") {
          setStatus({ kind: "ready" })
        }
      })
      await relaunch()
    } catch (e) {
      setStatus({ kind: "error", message: String(e) })
    }
  }

  function dismiss() {
    setStatus({ kind: "idle" })
  }

  // Initial silent check after the app settles.
  useEffect(() => {
    const t = setTimeout(() => runCheck(true), SILENT_INITIAL_DELAY_MS)
    return () => clearTimeout(t)
  }, [])

  // Native menu / settings button trigger a non-silent check.
  useEffect(() => {
    const u = listen("menu:check-updates", () => runCheck(false))
    return () => { u.then((fn) => fn()) }
  }, [])

  return { status, appVersion, runCheck, install, dismiss }
}
