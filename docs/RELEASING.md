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

1. Computes the semver version `YEAR.MONTH.<build-n>` (e.g. `2026.5.4`) — see [Version format](#version-format) — and creates the tag `v<version>` (e.g. `v2026.5.4`) at the chosen commit. Bails if that tag already exists.
2. Stamps that version into `tauri.conf.json`, `Cargo.toml`, and `package.json`.
3. Builds bundles in parallel for macOS arm64, macOS x86_64, Windows x64, and Linux x64. macOS bundles are ad-hoc codesigned during the build (`APPLE_SIGNING_IDENTITY=-`).
4. Uploads every artifact to a draft GitHub Release.
5. **Only after every platform succeeds:** promotes the draft to a published release, then publishes `latest.json` to `gh-pages/updates/`. This is what makes running mdwriter installs see the new version on their next check.
6. **If anything fails:** deletes the tag and the draft release so you can re-run from scratch.

Watch it at `Actions → Release`. ~10-20 minutes.

## Version format

One identifier is used everywhere so nothing can be mismatched:

| | example |
|---|---|
| version (bundle, `latest.json`) | `2026.6.16` |
| git tag | `v2026.6.16` |
| release title | `mdwriter 2026.6.16 (bcb8912)` |

The version is `YEAR.MONTH.<build-n>` (no leading zeros — semver forbids them). It's **not** the date — `<build-n>` is a per-month build counter, not the day. The git tag is just the version with a leading `v`. The release title leads with the version and carries the short SHA in parens for at-a-glance commit traceability (the tag also points at the commit).

The `tag` job computes `<build-n>` as **one higher than the highest version already released that month**: it lists existing releases (titles are `mdwriter <version> (<sha>)`), takes the max patch for the current `YEAR.MONTH`, and adds 1. A fresh month starts at `.1`.

Using max-plus-one (rather than a simple count) means the version can never go backwards — even if a release was rolled back, or when an older release that month used the previous `YYYY.M.D` scheme (whose patch happened to be the day-of-month). The updater compares versions with semver precedence, so a strictly-increasing version is what makes it recognize each release as newer. Because the tag is now valid semver, GitHub also orders releases (and picks the "Latest" badge) by semver precedence rather than lex-sorting — so no time component is needed in the tag to keep ordering correct.

## Same-day / same-month re-release

No longer a special case. Cut as many releases per day or month as you like — each gets the next consecutive `<build-n>` (e.g. `2026.6.16`, `2026.6.17`) and the updater treats it as a newer version, even from the same commit. The only way to collide is a true race — two workflow runs computing the same build number at the same instant — in which case the second's tag creation fails and you just re-run; the next number is free.

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
