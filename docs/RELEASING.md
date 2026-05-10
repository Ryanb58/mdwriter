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

The updater endpoint is `https://ryanb58.github.io/mdwriter/updates/latest.json` — wired into `tauri.conf.json`.

## Cutting a release

```bash
# 1. Make sure your working tree is clean and you're on main.
git status

# 2. Build the tag from today's date and the current commit.
TAG="v$(date +%Y-%m-%d).$(git rev-parse --short HEAD)"
echo "$TAG"   # e.g. v2026-05-10.a1b2c3d

# 3. Push it.
git tag "$TAG"
git push origin "$TAG"
```

That's it. The `release.yml` workflow:

1. Computes `2026.5.10` from the date portion of the tag.
2. Stamps that version into `tauri.conf.json`, `Cargo.toml`, and `package.json`.
3. Builds bundles in parallel for macOS arm64, macOS x86_64, Windows x64, and Linux x64.
4. Ad-hoc codesigns each macOS `.app` so future auto-updates don't re-trigger Gatekeeper.
5. Uploads every artifact to a draft GitHub release.
6. Generates `latest.json` from the collected `.sig` files.
7. Publishes `latest.json` to `gh-pages/updates/`.
8. Flips the draft release to published.

Watch the workflow at `Actions → Release`. It takes 10-20 minutes.

## Tag format

`vYYYY-MM-DD.<git-short-sha>`, e.g. `v2026-05-10.a1b2c3d`.

The trigger glob is `v20[0-9][0-9]-[0-9][0-9]-[0-9][0-9].*` — anything outside this shape won't kick the workflow.

The version baked into the bundle is `YYYY.M.D` (no leading zeros — semver doesn't allow them). The hash lives only in the tag and the release name for traceability.

## Same-day re-release

Two tags on the same day produce the same `YYYY.M.D` version, and Tauri's updater compares versions with semver — so a same-day re-release won't notify existing installs as a new update.

If you need to ship twice in one day, prefer rolling the date forward. If you really must ship the same date, push the second `latest.json` and the updater will pick it up on the next check (the Update plugin caches a tiny bit; a force-quit + relaunch clears it).

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
