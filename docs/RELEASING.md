# Releasing mdwriter

This is the runbook for cutting a release. The workflow is fully automated once a tag is pushed.

## Prerequisites (one-time)

### 1. Tauri update signing key

Generated with:

```bash
pnpm tauri signer generate -w ~/.tauri/mdwriter.key --password ""
```

The **public** key is already pinned in `src-tauri/tauri.conf.json` under `plugins.updater.pubkey`. Don't change it without coordinating an upgrade path for existing installs — every running mdwriter only trusts updates signed by this exact key.

The **private** key lives at `~/.tauri/mdwriter.key`. Back it up to a password manager. Losing this key means existing installs can never receive another update.

### 2. GitHub repo secrets

Set in `Settings → Secrets and variables → Actions`:

| Name | Value | Notes |
|---|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | Contents of `~/.tauri/mdwriter.key` | Required. One line, base64. |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | The passphrase you set | **Skip this secret entirely if you used `--password ""`.** GitHub won't accept empty-string secrets, and the workflow already treats a missing secret as "no password." |

```bash
# Copy the key contents to your clipboard:
cat ~/.tauri/mdwriter.key | pbcopy
# Then paste into the GitHub secret value field.
```

### 3. GitHub Pages

Enable GitHub Pages on the `gh-pages` branch (`Settings → Pages → Source: Deploy from a branch → gh-pages`). The release workflow creates this branch on first run if it doesn't exist.

The updater endpoint is `https://ryanb58.github.io/mdwriter/updates/latest.json` — wired into `tauri.conf.json`. The binaries the manifest points at live on a separate download host at `https://taylorbrazelton.com/mdwriter/`; that host must serve the same filenames the release workflow uploads to the GitHub release (e.g. `mdwriter_${VERSION}_macOS_Silicon.app.tar.gz`, `mdwriter_${VERSION}_macOS_Intel.app.tar.gz`, `mdwriter_${VERSION}_x64-setup.exe`). The simplest mirror is to sync the GitHub release's asset list to that path.

## Cutting a release

The workflow is **manually triggered** from the Actions tab.

1. Open `Actions → Release → Run workflow`.
2. Pick the branch you want to ship (usually `main`).
3. Optional: paste markdown release notes into the input field. Leave blank to fill them in later by editing the GitHub Release.
4. Click `Run workflow`.

That's it. The workflow:

1. Computes today's UTC date + time and the short SHA of the chosen commit, builds the tag `vYYYY-MM-DD.HHMMSS.<short-sha>`, and pushes it (e.g. `v2026-05-10.034106.a1b2c3d`). Bails if the tag already exists. It also computes the semver version `YEAR.MONTH.<build-n>` (e.g. `2026.5.4`) — see [Version format](#version-format).
2. Stamps that version into `tauri.conf.json`, `Cargo.toml`, and `package.json`.
3. Builds bundles in parallel for macOS arm64, macOS x86_64, Windows x64, and Linux x64. macOS bundles are ad-hoc codesigned during the build (`APPLE_SIGNING_IDENTITY=-`).
4. Uploads every artifact to a draft GitHub Release.
5. **Only after every platform succeeds:** promotes the draft to a published release, then publishes `latest.json` to `gh-pages/updates/`. This is what makes running mdwriter installs see the new version on their next check.
6. **If anything fails:** deletes the tag and the draft release so you can re-run from scratch.

Watch it at `Actions → Release`. ~10-20 minutes.

## Tag format

`vYYYY-MM-DD.HHMMSS.<git-short-sha>` (UTC time), e.g. `v2026-05-10.034106.a1b2c3d`. Created automatically by the workflow.

The hash and exact date/time live only in the tag and the release name for traceability. The `HHMMSS` component is what keeps the GitHub Releases page in recency order: tags aren't semver, so GitHub falls back to lex-sorting tag names — without a time component, two same-day releases would be ordered by their SHA letters instead of when they were cut.

## Version format

The version baked into the bundle is `YEAR.MONTH.<build-n>` (no leading zeros — semver forbids them), e.g. `2026.6.7`. It's **not** the date — `<build-n>` is a per-month build counter, not the day.

The `tag` job computes `<build-n>` as **one higher than the highest version already released that month**: it lists existing releases (titles are `mdwriter <version> (<tag>)`), takes the max patch for the current `YEAR.MONTH`, and adds 1. A fresh month starts at `.1`.

Using max-plus-one (rather than a simple count) means the version can never go backwards — even if a release was rolled back, or when an older release that month used the previous `YYYY.M.D` scheme (whose patch happened to be the day-of-month). The updater compares versions with semver precedence, so a strictly-increasing version is what makes it recognize each release as newer.

## Same-day / same-month re-release

No longer a special case. Cut as many releases per day or month as you like — each gets the next consecutive `<build-n>` and the updater treats it as a newer version. (Two releases *from the same commit on the same UTC second* would collide on the tag, not the version; the `tag` job bails on a duplicate tag, so just re-run a moment later or from a new commit.)

## Rollback / emergency revert

You don't have to re-cut a release to roll back — `latest.json` lives on `gh-pages` and can be edited directly.

```bash
# Check out gh-pages
git fetch origin gh-pages
git worktree add /tmp/mdwriter-pages gh-pages
cd /tmp/mdwriter-pages

# Restore the previous version's manifest
git log --oneline -- updates/latest.json
git checkout <previous-commit> -- updates/latest.json
git commit -m "Revert mdwriter manifest to previous version"
git push origin gh-pages

git worktree remove /tmp/mdwriter-pages
```

Existing installs will see the older version on their next update check.

## Adding paid OS-level signing later

When you eventually buy an Apple Developer account, follow the §3 checklist in `docs/superpowers/specs/2026-05-10-update-system.md`. Drop-in: add the six `APPLE_*` secrets, add the keychain-import step before the Tauri build, and the existing ad-hoc codesign step becomes a no-op.

When you buy a Windows code-signing cert, add `WINDOWS_CERTIFICATE` + `WINDOWS_CERTIFICATE_PASSWORD` and configure Tauri's signing in `tauri.conf.json`.

Both are independent — you can add either without the other.
