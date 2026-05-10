# mdwriter Auto-Update System — Design

**Date:** 2026-05-10
**Status:** Plan (not implemented)

## 1. Overview

Add an in-app auto-updater that fetches signed release bundles from GitHub Releases. Same pattern Tolaria uses: Tauri's `tauri-plugin-updater` reads a `latest.json` manifest hosted on GitHub Pages, downloads a minisign-signed bundle from the Releases asset URL, verifies the signature, replaces the app on next launch (or "passive" install on Windows).

### Goals

- Users on a released build get notified when a new version is available; one click installs.
- All bundles are signed and verified — no MITM risk.
- macOS bundles are also Apple-notarized so they pass Gatekeeper.
- Releases are produced from a tag via GitHub Actions — no manual upload step.
- A "Check for Updates" menu item triggers an on-demand check at any time.

### Non-goals (v1)

- Multiple release channels (stable + beta + nightly). v1 ships stable only; a parallel `latest-beta.json` can come later by parameterizing the workflow.
- In-app rollback. If a release is broken, ship a new one — Tauri's updater can install the same or older version if we point the manifest there.
- Delta updates. Always download the full bundle.
- Linux AppImage auto-update — supported by Tauri but requires `appimagetool` plumbing. v1 produces a `.deb` and `.AppImage` for download but does not auto-update Linux (manual install).
- In-app changelog rendering beyond the release notes string the manifest carries.

## 2. Architecture

```
┌──────────────────────────────────────────────────────────┐
│                   Developer pushes tag                    │
│                  (e.g. v2026-06-15)                       │
└────────────────────┬─────────────────────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────────────────────┐
│   GitHub Actions: release.yml                            │
│                                                          │
│   matrix:                                                │
│     macos-arm64  · macos-x86_64                          │
│     windows-x86_64 · linux-x86_64                        │
│                                                          │
│   for each platform:                                     │
│     pnpm install                                         │
│     import code-signing cert                             │
│     `pnpm tauri build` (with TAURI_SIGNING_PRIVATE_KEY)  │
│       → produces:                                        │
│         - mdwriter_<v>_<arch>.app.tar.gz                 │
│         - mdwriter_<v>_<arch>.app.tar.gz.sig             │
│         - mdwriter_<v>_<arch>.dmg                        │
│         - mdwriter_<v>_x86_64-setup.exe                  │
│         - mdwriter_<v>_x86_64.msi                        │
│         - mdwriter_<v>_amd64.AppImage / .deb             │
│     notarize (macOS only)                                │
│     upload all artifacts to GitHub Release               │
│                                                          │
│   final job:                                             │
│     read each .sig file                                  │
│     emit `latest.json`                                   │
│     push to `gh-pages` branch under /updates/latest.json │
└────────────────────┬─────────────────────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────────────────────┐
│      GitHub Pages serves                                  │
│      https://ryanb58.github.io/mdwriter/updates/         │
│        latest.json    ← polled by the app                │
└────────────────────┬─────────────────────────────────────┘
                     │ HTTP GET (on app launch + on-demand)
                     ▼
┌──────────────────────────────────────────────────────────┐
│  Running mdwriter app                                     │
│    tauri-plugin-updater                                   │
│    1. fetch latest.json                                   │
│    2. semver compare against current                      │
│    3. if newer: download .tar.gz / .msi / .AppImage       │
│    4. verify minisign signature against pubkey            │
│    5. extract + replace on next launch                    │
└──────────────────────────────────────────────────────────┘
```

### Why GitHub Pages and not raw release URLs?

Two reasons:
- The manifest URL must be stable across releases. `releases/latest/download/latest.json` works, but a redirect adds latency and some networks block it.
- Updating `latest.json` independently of the release lets us promote/demote a build (e.g., point back at the previous version if a release is bad) without re-cutting it.

### Manifest format (`latest.json`)

```json
{
  "version": "2026.6.15",
  "notes": "Bug fixes and Block editor improvements. Full changelog at https://github.com/Ryanb58/mdwriter/releases/tag/v2026-06-15",
  "pub_date": "2026-06-15T20:00:00Z",
  "platforms": {
    "darwin-aarch64": {
      "signature": "untrusted comment: ...\nRWS...\n",
      "url": "https://github.com/Ryanb58/mdwriter/releases/download/v2026-06-15/mdwriter_2026.6.15_aarch64.app.tar.gz"
    },
    "darwin-x86_64": {
      "signature": "...",
      "url": "https://github.com/Ryanb58/mdwriter/releases/download/v2026-06-15/mdwriter_2026.6.15_x86_64.app.tar.gz"
    },
    "windows-x86_64": {
      "signature": "...",
      "url": "https://github.com/Ryanb58/mdwriter/releases/download/v2026-06-15/mdwriter_2026.6.15_x64-setup.exe"
    }
  }
}
```

Linux entries are intentionally omitted in v1 — the Linux installer in `bundle.targets` produces an AppImage but updating it in place requires the AppImage to know its own path and use `appimageupdate`. Worth its own follow-up.

## 3. Cryptographic keys and secrets

### Tauri update signing key (one-time setup)

```bash
pnpm tauri signer generate -w ~/.tauri/mdwriter.key
# Prompts for a passphrase; writes the private key to ~/.tauri/mdwriter.key
# and prints the public key to stdout.
```

**Store the public key** in `tauri.conf.json` under `plugins.updater.pubkey` (base64 string, ~150 chars).

**Store the private key** as a GitHub repo secret:
- `TAURI_SIGNING_PRIVATE_KEY` — the contents of `~/.tauri/mdwriter.key` (base64).
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — the passphrase you chose.

Never commit the private key. Losing the private key means you can never ship another update to existing installs that pin this pubkey — back it up to a password manager.

### Apple Developer signing (macOS only)

Required to produce a notarized DMG that passes Gatekeeper without scary warnings. Without it, users get a "this app cannot be opened" dialog on first launch.

- Enroll in Apple Developer Program ($99/year). Skip if you're okay with users right-clicking → Open the first time.
- Generate a Developer ID Application certificate from developer.apple.com, export as `.p12`.
- Repo secrets:
  - `APPLE_CERTIFICATE` — base64-encoded `.p12`
  - `APPLE_CERTIFICATE_PASSWORD` — the `.p12` passphrase
  - `APPLE_SIGNING_IDENTITY` — e.g., `Developer ID Application: Your Name (TEAMID)`
  - `APPLE_ID` — Apple ID email used for notarization
  - `APPLE_PASSWORD` — an app-specific password for that Apple ID (generated at appleid.apple.com)
  - `APPLE_TEAM_ID` — 10-character team ID

### Windows signing (optional, recommended)

Without code signing, Windows users get a SmartScreen warning. To remove it:
- Buy an EV or OV code-signing certificate from a CA (DigiCert, Sectigo, etc.) — $250-$500/year.
- Or skip for v1 and document that users may need to click "More info → Run anyway."

Deferred for v1 unless you already have a cert.

## 4. Implementation phases

Each task is ordered so an earlier dev release can ship while later ones land.

### Phase 0 — Configure the updater plugin (~30 min)

**Files:**
- `src-tauri/Cargo.toml` — add `tauri-plugin-updater = "2"`
- `src-tauri/src/lib.rs` — register `tauri_plugin_updater::Builder::new().build()`
- `src-tauri/tauri.conf.json` — add the `plugins.updater` block and `bundle.createUpdaterArtifacts: true`
- `src-tauri/capabilities/default.json` — add `updater:default`

**Tasks:**
- [ ] Generate signing key with `pnpm tauri signer generate -w ~/.tauri/mdwriter.key`
- [ ] Paste pubkey into `tauri.conf.json`:
  ```json
  "plugins": {
    "updater": {
      "endpoints": [
        "https://ryanb58.github.io/mdwriter/updates/latest.json"
      ],
      "windows": { "installMode": "passive" },
      "pubkey": "<paste here>"
    }
  }
  ```
- [ ] Add `"createUpdaterArtifacts": true` under `"bundle"`.
- [ ] Run `pnpm tauri build` locally with `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` exported to confirm it emits `.app.tar.gz` + `.sig` (and the corresponding Windows/Linux artifacts on those platforms).

### Phase 1 — Frontend update flow (~2-3 hours)

**Files:**
- `src/features/updates/useUpdates.ts` — new hook: on mount, check for an update; expose `checkForUpdates`, `applyUpdate`, `status`.
- `src/features/updates/UpdateBanner.tsx` — non-blocking banner in the editor footer when an update is downloaded and ready.
- `src/features/updates/UpdateDialog.tsx` — optional modal with release notes + Install / Later buttons.
- `src/App.tsx` — mount the hook + banner.
- `src/features/settings/SettingsPanel.tsx` — add `About` section with current version + "Check for Updates" button.
- `src-tauri/src/lib.rs` — add "Check for Updates…" menu item to the mdwriter submenu; emits `menu:check-updates` event.

**Behavior:**
- On launch (after 10s delay so we don't compete with the vault load): silently call `check()`.
- If available: show banner "mdwriter 2026.6.15 is ready to install." with `Restart Now` / `Later` buttons.
- Clicking Restart Now: call `update.downloadAndInstall(progress => ...)` showing a progress bar, then `relaunch()`.
- Settings → About: display current `app.getVersion()`, with a "Check for Updates" button that surfaces the current state (no updates / new version found / error).
- Menu → mdwriter → Check for Updates… → same as the settings button.

**Code sketch — `useUpdates.ts`:**
```ts
import { useEffect, useState } from "react"
import { check, type Update } from "@tauri-apps/plugin-updater"
import { relaunch } from "@tauri-apps/plugin-process"
import { listen } from "@tauri-apps/api/event"

type Status =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "available"; update: Update }
  | { kind: "downloading"; bytes: number; total: number | null }
  | { kind: "ready" }
  | { kind: "current" }
  | { kind: "error"; message: string }

export function useUpdates() {
  const [status, setStatus] = useState<Status>({ kind: "idle" })

  async function runCheck(silent = false) {
    setStatus({ kind: "checking" })
    try {
      const update = await check()
      if (!update) return setStatus({ kind: "current" })
      setStatus({ kind: "available", update })
    } catch (e) {
      if (!silent) setStatus({ kind: "error", message: String(e) })
    }
  }

  async function install() {
    if (status.kind !== "available") return
    const update = status.update
    let bytes = 0
    setStatus({ kind: "downloading", bytes: 0, total: update.contentLength ?? null })
    await update.downloadAndInstall((e) => {
      if (e.event === "Progress") {
        bytes += e.data.chunkLength
        setStatus({ kind: "downloading", bytes, total: update.contentLength ?? null })
      }
      if (e.event === "Finished") setStatus({ kind: "ready" })
    })
    await relaunch()
  }

  useEffect(() => {
    const t = setTimeout(() => runCheck(true), 10_000)
    const u = listen("menu:check-updates", () => runCheck(false))
    return () => { clearTimeout(t); u.then((fn) => fn()) }
  }, [])

  return { status, runCheck, install }
}
```

Add the `@tauri-apps/plugin-process` package for `relaunch`.

### Phase 2 — Release workflow (~3-4 hours)

**File:** `.github/workflows/release.yml`

Triggered by tags matching `v20*-*-*` (e.g., `v2026-06-15`) so semantic-versioned mistakes don't accidentally cut a release.

**Matrix:** macos-15 (aarch64 + x86_64), windows-latest (x86_64), ubuntu-latest (x86_64).

**Per-platform job steps:**
1. Checkout
2. Setup pnpm, Node 22, Rust stable with the matrix target
3. Cache `~/.cargo/registry`, `~/.cargo/git`, `src-tauri/target`
4. `pnpm install --frozen-lockfile`
5. Compute version from tag: `v2026-06-15` → `2026.6.15`. Update `tauri.conf.json` and `Cargo.toml` `[package].version` in-place
6. **macOS only:** import Apple cert into a fresh keychain (the same pattern Tolaria uses — base64 decode into a tmp `.p12`, `security create-keychain`, `security import`, `security set-key-partition-list`)
7. Run `pnpm tauri build` with these env vars:
   - `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — always
   - macOS only: `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`
8. Use `tauri-apps/tauri-action@v0` OR a custom script to upload artifacts to a GitHub Release (draft).

**Final aggregation job (`publish-manifest`):**
1. `needs: [build]` for all matrix entries
2. Download each platform's `.sig` text artifact
3. Generate `latest.json` (see manifest format above)
4. Commit `latest.json` to `gh-pages` branch under `updates/latest.json` via `peaceiris/actions-gh-pages@v3`
5. Publish the GitHub Release (was draft) so the asset download URLs work

**Why tag pattern `v20*-*-*`:** keeps the release trigger explicit and avoids cutting from arbitrary tags. Adjust if you prefer semver tags like `v0.2.0`.

### Phase 3 — Apple notarization plumbing (~1-2 hours, macOS only)

If Apple Developer enrollment is in place:
- The `pnpm tauri build` command above already handles signing if `APPLE_SIGNING_IDENTITY` is set.
- For notarization, set the additional env vars (`APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`) and the Tauri build process will submit to the notary service and staple the ticket.
- Add a `Build & notarize` step that waits for notarization to complete (Tauri's process does, but it can be slow — 5-15 min).

If skipped, document that macOS users must right-click → Open the first time.

### Phase 4 — Documentation + release runbook (~30 min)

**Files:**
- `docs/RELEASING.md` — step-by-step manual checklist:
  1. Decide what's going in the release (review commits since last tag).
  2. Write release notes draft (will appear in the `notes` field).
  3. Tag with `git tag v2026-06-15 && git push origin v2026-06-15`.
  4. Watch the workflow; if green, the GitHub Release publishes itself and the manifest updates.
  5. Verify by running an old build locally and watching it pick up the update.
- `docs/UPDATER-KEY-RECOVERY.md` — what to do if the private key is lost (TL;DR: you can't; ship a new app under a new identifier and migrate users manually).

### Phase 5 — Test plan

| Scenario | How to verify |
|---|---|
| Fresh install → no update | Build current version locally, run, click Check for Updates → "You're up to date." |
| Older install → update available | Modify `version` in `tauri.conf.json` down to `0.0.1`, rebuild as `dev` build, run, observe the banner appears within 15s. |
| Apply update | From the banner, click Restart Now; observe the progress bar, then app restarts on the new version. Verify `getVersion()` reports the new value. |
| Bad signature | Manually replace the `.sig` URL in `latest.json` with a different file. Run an old build → updater rejects the download with a signature error. |
| Network failure | Disconnect Wi-Fi, click Check for Updates → friendly error, app keeps running. |
| Cancelled mid-download | Use the dev tools network throttle to make the download slow, click Cancel (need to add Cancel to the UI). Verify state returns to "available." |

E2E for the GH Actions side:
- Manually trigger the workflow on a throwaway branch and tag (`v2026-99-99`) targeting a private repo. Verify all artifacts upload + manifest publishes.

## 5. Trade-offs

- **GitHub Pages dependency.** If GitHub Pages is down, no one gets updates. Acceptable for an open-source desktop tool; if uptime becomes critical, point the manifest at a CDN-hosted JSON instead.
- **Single channel.** v1 ships stable only. Adding beta is straightforward: a parallel `release-beta.yml` writing to `updates/latest-beta.json` and a setting in the app to switch endpoints. Defer until you have a reason for it.
- **No partial/diff updates.** Each update redownloads the whole bundle (~10-15 MB for mdwriter). For a writing tool with infrequent releases, this is fine.
- **Linux auto-update gap.** AppImage updating in place requires the running binary to know its own path, which it does, but the `appimageupdate` tool is awkward to bundle. Skip for v1; document the manual upgrade.
- **Tauri target version drift.** When Tauri 3 lands and we upgrade, the update manifest format may change. The pubkey stays valid; old clients pinned to the v2 format will still work as long as we keep publishing the v2 manifest URL (a small annoyance but manageable).

## 6. Effort estimate

- Phase 0 (plugin + key + config): 30 min
- Phase 1 (frontend UI): 2-3 hours
- Phase 2 (release workflow): 3-4 hours
- Phase 3 (Apple notarization): 1-2 hours (assuming dev enrollment already done; +half a day if not)
- Phase 4 (docs): 30 min
- Phase 5 (testing): 1-2 hours

**Total:** ~1-1.5 focused days for a single-channel macOS+Windows release pipeline. Add 0.5 day if Linux AppImage auto-update is in scope.

## 7. Open questions to resolve before starting

1. **Apple Developer Program** — enrolled, or skip notarization for v1?
2. **Windows code-signing cert** — have one, or accept SmartScreen warnings?
3. **Tag scheme** — calendar (`vYYYY-MM-DD`, like Tolaria), semver (`v0.2.0`), or both?
4. **Release cadence** — manual on every push to main, or scheduled / on demand?
5. **Telemetry** — should the check report anonymous version + OS to a metrics endpoint? Tolaria sends a `app_check_for_updates` event to PostHog. Defer.
