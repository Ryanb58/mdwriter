# mdwriter

A fast, lightweight desktop markdown editor. Block editor with a Properties pane for YAML frontmatter, a left file tree with create/rename/delete, fuzzy file palette (Cmd+P), raw markdown toggle (Cmd+E), and external file watching.

Built with Tauri 2, React, TypeScript, BlockNote, and CodeMirror.

## Install

Download the latest `.dmg` (macOS), `.msi` (Windows), or `.AppImage` / `.deb` (Linux) from the [Releases page](https://github.com/Ryanb58/mdwriter/releases/latest).

### First launch on macOS

mdwriter is not (yet) signed with an Apple Developer ID, so macOS will warn you on first launch:

> "mdwriter cannot be opened because Apple cannot check it for malicious software."

To open it the first time:

- **Right-click** the `mdwriter.app` icon (in Applications or wherever you put it) and choose **Open** from the menu.
- Click **Open** in the confirmation dialog.

After this one-time approval, normal double-click launches work, and auto-updates install silently.

Alternative — strip the quarantine flag from a terminal:

```sh
xattr -d com.apple.quarantine /Applications/mdwriter.app
```

### First launch on Windows

mdwriter is not (yet) signed with a code-signing certificate, so Windows SmartScreen will show:

> "Windows protected your PC."

Click **More info**, then **Run anyway**.

### Updates

mdwriter checks for updates ~10 seconds after launch. When one is available, a banner appears in the bottom-right of the window — click **Restart and install** to apply, or dismiss for later. Manual checks via **mdwriter → Check for Updates…** in the macOS menu, or **Settings → About → Check for Updates** on any platform.

Update payloads are signed with a Tauri minisign key — the app rejects tampered downloads even though the OS isn't signing the app itself.

## Develop

    pnpm install
    pnpm tauri dev

## Test

    pnpm test          # frontend unit
    cargo test --manifest-path src-tauri/Cargo.toml --lib
    pnpm test:e2e      # smoke

## Build

    pnpm tauri build

## Release

See [`docs/RELEASING.md`](docs/RELEASING.md) for the runbook.

## Design docs

- `docs/superpowers/specs/2026-05-09-mdwriter-design.md` — original design
- `docs/superpowers/specs/2026-05-10-update-system.md` — auto-update system design
- `docs/superpowers/plans/2026-05-09-mdwriter.md` — original implementation plan
