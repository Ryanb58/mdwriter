import { useEffect, useRef, useState } from "react"
import { check, type Update } from "@tauri-apps/plugin-updater"
import { relaunch } from "@tauri-apps/plugin-process"
import { listenForThisWindow } from "../../lib/windowEvents"
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

/**
 * Turn an updater error into a short, human-readable message. The raw error
 * coming back from the plugin is often a verbose Rust string (or a reqwest
 * transport error) that means nothing to a user; map the common failure
 * shapes to plain language while keeping the original around for context.
 */
export function describeUpdateError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e)
  const lower = raw.toLowerCase()

  if (
    lower.includes("signature") ||
    lower.includes("verify") ||
    lower.includes("untrusted") ||
    lower.includes("minisign")
  ) {
    return "The update could not be verified (invalid signature). For your safety it was not installed."
  }
  if (
    lower.includes("network") ||
    lower.includes("connect") ||
    lower.includes("dns") ||
    lower.includes("timed out") ||
    lower.includes("timeout") ||
    lower.includes("request error") ||
    lower.includes("error sending request") ||
    lower.includes("os error")
  ) {
    return "Couldn't reach the update server. Check your connection and try again."
  }
  return raw || "Update failed for an unknown reason."
}

export function useUpdates() {
  const [status, setStatus] = useState<UpdateStatus>({ kind: "idle" })
  const [appVersion, setAppVersion] = useState<string>("")
  // Guards against overlapping check/install runs (e.g. the 10s silent timer
  // racing a manual "Check for Updates" click, or a double-click on Install).
  const busyRef = useRef(false)

  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => {})
  }, [])

  async function runCheck(silent = false) {
    if (busyRef.current) return
    busyRef.current = true
    setStatus({ kind: "checking" })
    try {
      const update = await check()
      if (!update) {
        setStatus({ kind: "current" })
        return
      }
      setStatus({ kind: "available", update })
    } catch (e) {
      // In dev / unsigned local builds the updater can't fetch; stay quiet on
      // the automatic background check so we never nag with a spurious banner.
      if (silent) {
        setStatus({ kind: "idle" })
        return
      }
      setStatus({ kind: "error", message: describeUpdateError(e) })
    } finally {
      busyRef.current = false
    }
  }

  async function install() {
    if (status.kind !== "available") return
    if (busyRef.current) return
    busyRef.current = true
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
      setStatus({ kind: "error", message: describeUpdateError(e) })
    } finally {
      // relaunch() never returns on success; this only runs if it threw.
      busyRef.current = false
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
    const u = listenForThisWindow("menu:check-updates", () => runCheck(false))
    return () => { u.then((fn) => fn()) }
  }, [])

  return { status, appVersion, runCheck, install, dismiss }
}
