# mdwriter Auto-Update System — Design

**Date:** 2026-05-10
**Status:** Plan (not implemented)

## 1. Overview

Add an in-app auto-updater that fetches signed release bundles from GitHub Releases. Same pattern Tolaria uses: Tauri's `tauri-plugin-updater` reads a `latest.json` manifest hosted on GitHub Pages, downloads a minisign-signed bundle from the Releases asset URL, verifies the signature, replaces the app on next launch (or "passive" install on Windows).

### Goals

- Users on a released build get notified when a new version is available; one click installs.
- The **update payload itself** is signed with a minisign key and verified by the Tauri updater before install — so even though the OS treats the bundle as "from an unidentified developer," users can't be MITM-attacked into installing a tampered build.
- Releases are produced from a tag via GitHub Actions — no manual upload step.
- A "Check for Updates" menu item triggers an on-demand check at any time.

### Non-goals (v1)

- **Apple Developer signing / notarization.** Skipped for v1 — costs $99/year and adds CI complexity. macOS users will see "mdwriter cannot be opened because Apple cannot check it for malicious software" on first launch and must right-click → Open. Auto-updates still work (see §3.2). Wired in as a follow-up when a Developer ID is in hand.
- **Windows code signing.** Same logic — Windows users will see a SmartScreen warning ("Windows protected your PC") and must click "More info → Run anyway." Add later if a code-signing cert is purchased.
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
│     `pnpm tauri build` (with TAURI_SIGNING_PRIVATE_KEY)  │
│       → produces:                                        │
│         - mdwriter_<v>_<arch>.app.tar.gz                 │
│         - mdwriter_<v>_<arch>.app.tar.gz.sig             │
│         - mdwriter_<v>_<arch>.dmg                        │
│         - mdwriter_<v>_x86_64-setup.exe                  │
│         - mdwriter_<v>_x86_64.msi                        │
│         - mdwriter_<v>_amd64.AppImage / .deb             │
│     ad-hoc codesign macOS .app (no Apple ID required)    │
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

### 3.1 OS-level code signing (deferred)

**Apple Developer signing / notarization — deferred.** Costs $99/year and adds non-trivial CI plumbing. Without it, macOS users see "mdwriter cannot be opened because Apple cannot check it for malicious software" on first launch. The plan keeps a placeholder so it's a clean drop-in when ready (see §6 follow-up).

**Windows code-signing — deferred.** $250-$500/year for an OV cert. Without it, users see SmartScreen "Windows protected your PC."

The Tauri minisign signature (the one tied to `pubkey`) is **separate** and ships in v1. It protects update integrity (the auto-updater refuses tampered downloads) regardless of OS-level signing.

### 3.2 macOS first-launch UX without notarization

Document this clearly in the README and on the download page so users aren't confused:

> **First launch on macOS:** Right-click the `mdwriter.app` icon and choose **Open**. macOS will warn "the app is from an unidentified developer" — confirm by clicking **Open** in the dialog. After that, future launches work normally.
>
> Alternatively, from a terminal:
> ```sh
> xattr -d com.apple.quarantine /Applications/mdwriter.app
> ```

For auto-updates the situation is better: Tauri's updater extracts the new bundle in place over the running app, and macOS does **not** re-quarantine it because the source is the same already-trusted process. So the right-click dance only happens on the very first install. A few caveats:

- We **must** still ad-hoc codesign the bundle in CI (`codesign --force --deep --sign - mdwriter.app`) so macOS treats updates as the same app identity. Without ad-hoc signing, Gatekeeper may treat each update as a new unsigned app and re-quarantine it.
- The ad-hoc step uses no Apple ID and no certificate — it's a single shell command in the workflow.

**That's why the architecture diagram in §2 says "ad-hoc codesign macOS .app (no Apple ID required)" instead of "import code-signing cert."**

### 3.3 Windows first-launch UX without code signing

> **First launch on Windows:** SmartScreen will say "Windows protected your PC." Click **More info**, then **Run anyway**.

There is no auto-update equivalent of the macOS ad-hoc trick on Windows — `passive` install mode runs the new MSI/EXE, which may itself trigger SmartScreen on each update. Acceptable trade-off until a cert is purchased.

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

Triggered by tags matching `v20[0-9][0-9]-[0-9][0-9]-[0-9][0-9].*` (e.g., `v2026-05-10.a1b2c3d`) so semantic-version mistakes don't accidentally cut a release. See §8 for the full tag scheme.

**Matrix:** macos-15 (aarch64 + x86_64), windows-latest (x86_64), ubuntu-latest (x86_64).

**Per-platform job steps:**
1. Checkout
2. Setup pnpm, Node 22, Rust stable with the matrix target
3. Cache `~/.cargo/registry`, `~/.cargo/git`, `src-tauri/target`
4. `pnpm install --frozen-lockfile`
5. Compute version from tag: `v2026-05-10.a1b2c3d` → `2026.5.10` (date portion only; see §8 for the bash one-liner). Update `tauri.conf.json` and `Cargo.toml` `[package].version` in-place
6. Run `pnpm tauri build` with these env vars (only the Tauri minisign secrets are needed in v1):
   - `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
7. **macOS only — ad-hoc codesign** so the OS treats updates as the same identity (no Apple ID required):
   ```sh
   APP="src-tauri/target/$TARGET/release/bundle/macos/mdwriter.app"
   codesign --force --deep --sign - "$APP"
   # Re-tar the .app so the signature ends up in the updater payload.
   ditto -c -k --keepParent "$APP" "$APP.tar.gz"
   ```
8. Use `tauri-apps/tauri-action@v0` OR a custom script to upload artifacts to a GitHub Release (draft).

**Note:** because there's no Apple cert, we don't need the keychain-import step Tolaria's workflow has, and we can skip the entire notarization wait. That removes ~10 minutes from the macOS build time and ~6 secrets from the repo configuration.

**Final aggregation job (`publish-manifest`):**
1. `needs: [build]` for all matrix entries
2. Download each platform's `.sig` text artifact
3. Generate `latest.json` (see manifest format above)
4. Commit `latest.json` to `gh-pages` branch under `updates/latest.json` via `peaceiris/actions-gh-pages@v3`
5. Publish the GitHub Release (was draft) so the asset download URLs work

**Why tag pattern `v20*-*-*`:** keeps the release trigger explicit and avoids cutting from arbitrary tags. Adjust if you prefer semver tags like `v0.2.0`.

### Phase 3 — Future-proofing for paid signing (no work in v1)

Designed so OS-level signing drops in without rewriting the workflow when you're ready to pay for it.

**When you eventually buy an Apple Developer ID** (~1-2 hours of follow-up work):

1. Add the six Apple secrets to the repo:
   - `APPLE_CERTIFICATE` — base64-encoded `.p12`
   - `APPLE_CERTIFICATE_PASSWORD`
   - `APPLE_SIGNING_IDENTITY` — `Developer ID Application: Your Name (TEAMID)`
   - `APPLE_ID`, `APPLE_PASSWORD` (app-specific), `APPLE_TEAM_ID`
2. Insert a "Import Apple cert" step before the `pnpm tauri build` macOS step (the Tolaria recipe — `security create-keychain`, `security import`, `security set-key-partition-list`).
3. Add the six secrets to the `pnpm tauri build` step's `env:`. Tauri detects `APPLE_SIGNING_IDENTITY` and runs codesign + notarization automatically; the manual `codesign --sign -` step from Phase 2 step 7 becomes a no-op and can be deleted.
4. Bump the macOS job timeout — notarization round-trips can take 5-15 min.
5. Drop the macOS first-launch warning from the README.

**When you eventually buy a Windows code-signing cert** (~1 hour of follow-up):

1. Add `WINDOWS_CERTIFICATE` (base64 .pfx) and `WINDOWS_CERTIFICATE_PASSWORD`.
2. Configure `bundle.windows.certificateThumbprint` or use SignTool in a post-build step.
3. Drop the SmartScreen warning from the README.

Until then, both lanes ship unsigned but minisign-verified bundles.

### Phase 4 — Documentation + release runbook (~30 min)

**Files:**
- `docs/RELEASING.md` — step-by-step manual checklist:
  1. Decide what's going in the release (review commits since last tag).
  2. Write release notes draft (will appear in the `notes` field).
  3. Tag with `git tag "v$(date +%Y-%m-%d).$(git rev-parse --short HEAD)" && git push origin "$(git describe --exact-match HEAD)"`.
  4. Watch the workflow; if green, the GitHub Release publishes itself and the manifest updates.
  5. Verify by running an old build locally and watching it pick up the update.
- `docs/UPDATER-KEY-RECOVERY.md` — what to do if the private key is lost (TL;DR: you can't; ship a new app under a new identifier and migrate users manually).
- `README.md` — add a "First launch" section that explains the macOS right-click → Open dance and the Windows SmartScreen "More info → Run anyway" dance until paid signing is in place.

### Phase 5 — Test plan

| Scenario | How to verify |
|---|---|
| Fresh install → no update | Build current version locally, run, click Check for Updates → "You're up to date." |
| Older install → update available | Modify `version` in `tauri.conf.json` down to `0.0.1`, rebuild as `dev` build, run, observe the banner appears within 15s. |
| Apply update | From the banner, click Restart Now; observe the progress bar, then app restarts on the new version. Verify `getVersion()` reports the new value. |
| Bad signature | Manually replace the `.sig` URL in `latest.json` with a different file. Run an old build → updater rejects the download with a signature error. |
| Network failure | Disconnect Wi-Fi, click Check for Updates → friendly error, app keeps running. |
| Cancelled mid-download | Use the dev tools network throttle to make the download slow, click Cancel (need to add Cancel to the UI). Verify state returns to "available." |
| **macOS auto-update keeps app trusted** | Manually `xattr -d com.apple.quarantine` an old install, run it, accept an auto-update, relaunch from `/Applications`. Should open without re-prompting Gatekeeper because the ad-hoc signature persists. |
| **macOS first launch warning** | Download the bundle from a release on a fresh Mac (or wipe quarantine bit on a test box), double-click → confirm the Gatekeeper dialog appears, then right-click → Open works. |

E2E for the GH Actions side:
- Manually trigger the workflow on a throwaway branch and tag (`v2026-99-99`) targeting a private repo. Verify all artifacts upload + manifest publishes.

## 5. Trade-offs

- **No paid OS-level signing.** The minisign signature still protects update integrity, but every fresh download has to clear the OS gatekeeper manually. Acceptable for early users / a side project; revisit when there's a wider audience or an external distribution channel.
- **Auto-update preserves macOS trust, fresh install does not.** Once a user has done the right-click → Open dance once, every subsequent auto-update lands silently because we ad-hoc sign. So the friction is one-time per install, not per release.
- **GitHub Pages dependency.** If GitHub Pages is down, no one gets updates. Acceptable for an open-source desktop tool; if uptime becomes critical, point the manifest at a CDN-hosted JSON instead.
- **Single channel.** v1 ships stable only. Adding beta is straightforward: a parallel `release-beta.yml` writing to `updates/latest-beta.json` and a setting in the app to switch endpoints. Defer until you have a reason for it.
- **No partial/diff updates.** Each update redownloads the whole bundle (~10-15 MB for mdwriter). For a writing tool with infrequent releases, this is fine.
- **Linux auto-update gap.** AppImage updating in place requires the running binary to know its own path, which it does, but the `appimageupdate` tool is awkward to bundle. Skip for v1; document the manual upgrade.
- **Tauri target version drift.** When Tauri 3 lands and we upgrade, the update manifest format may change. The pubkey stays valid; old clients pinned to the v2 format will still work as long as we keep publishing the v2 manifest URL (a small annoyance but manageable).

## 6. Effort estimate

- Phase 0 (plugin + key + config): 30 min
- Phase 1 (frontend UI): 2-3 hours
- Phase 2 (release workflow): 2-3 hours (dropped Apple cert + notarization plumbing)
- Phase 3 (paid signing future-proofing): 0 in v1 (1-2 hours when you eventually add Apple Dev; +1 hour for Windows)
- Phase 4 (docs): 30 min
- Phase 5 (testing): 1-2 hours

**Total v1:** **~6-9 hours of focused work.** Less than originally estimated because the OS-level signing legwork is deferred. Add 1-2 hours later when the Apple cert lands.

## 7. Open questions

1. ~~**Apple Developer Program**~~ — **Resolved: deferred.** v1 ships unsigned with ad-hoc codesign for update consistency.
2. ~~**Windows code-signing cert**~~ — **Resolved: deferred.** Same path as macOS.
3. ~~**Tag scheme**~~ — **Resolved: `vYYYY-MM-DD.<git-short-hash>`**, e.g. `v2026-05-10.a1b2c3d`. The hash makes each tag unique even on same-day re-releases and links the tag back to the exact commit. (See §8 for the version-derivation rule.)
4. **Release cadence** — undecided. v1 of the workflow is triggered manually by pushing a tag; we'll choose between scheduled cadence vs ad-hoc when there's actual usage data. Workflow design doesn't depend on this.
5. ~~**Telemetry**~~ — **Resolved: no.** No update-check telemetry in v1. The plain Tauri updater fetch already shows up in GitHub Pages access logs if we ever need rough usage signal.
6. ~~**macOS first-launch dialog UX**~~ — **Resolved: README only.** Skip the separate download landing page; cover both the macOS right-click → Open dance and the Windows SmartScreen "More info → Run anyway" dance in the project README's "First launch" section.

## 8. Tag scheme details

**Tag format:** `vYYYY-MM-DD.<short-sha>` where `<short-sha>` is `git rev-parse --short HEAD` (7 chars by default).

Examples:
- `v2026-05-10.a1b2c3d`
- `v2026-06-15.f9e8d7c`

**Workflow trigger:**
```yaml
on:
  push:
    tags:
      - 'v20[0-9][0-9]-[0-9][0-9]-[0-9][0-9].*'
```

**Version derived from the tag (used in `tauri.conf.json` and `Cargo.toml`):** the date portion only, formatted as `YYYY.M.D` (no leading zeros — semver doesn't allow them).

Examples:
- Tag `v2026-05-10.a1b2c3d` → version `2026.5.10`
- Tag `v2026-06-15.f9e8d7c` → version `2026.6.15`

**Why drop the short hash from the version:** Tauri's auto-updater compares versions with semver. Build metadata (`2026.5.10+a1b2c3d`) is ignored by the comparator, and pre-release suffixes (`2026.5.10-a1b2c3d`) sort *below* the unsuffixed version. Keeping the version pure-semver-calendar avoids both pitfalls. The hash lives in the tag, the GitHub release name, and the release notes for traceability — the version doesn't need it.

**Same-day re-release caveat:** if you need to ship twice in one day, the second tag's hash differs but the derived version is identical, so existing installs won't see a new update. Two safe options: (a) wait until tomorrow's date, or (b) cherry-pick the fix and re-tag with the same `vYYYY-MM-DD.X` but a different hash, then manually bump the manifest to `2026.5.10` again — only works because the Tauri updater also caches by hash, so a bumped `latest.json` re-fetches. Document this in `RELEASING.md`.

**Version-derivation step in CI (Bash):**
```bash
TAG="${GITHUB_REF_NAME}"           # e.g. v2026-05-10.a1b2c3d
DATE_PART="${TAG#v}"               # 2026-05-10.a1b2c3d
DATE_PART="${DATE_PART%%.*}"       # 2026-05-10
IFS='-' read -r Y M D <<< "$DATE_PART"
VERSION="$((10#$Y)).$((10#$M)).$((10#$D))"
echo "version=$VERSION"            # 2026.5.10
```
