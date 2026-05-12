# mdwriter

A fast, native Markdown editor that keeps your files yours.

Write in a clean block editor, save plain `.md` files to any folder on your machine, and walk away whenever you want — no proprietary database, no sync service, no lock-in.

## Why mdwriter

- **Plain Markdown on disk.** Every note is a `.md` file in a folder you chose. Open them in any other editor. Sync them with iCloud, Dropbox, git — whatever you already use.
- **A block editor that respects the format.** Blocks, slash commands, drag-to-reorder. Saves back to clean Markdown you'd be happy to read by hand.
- **Frontmatter without writing YAML.** A Properties pane edits your frontmatter as real form fields. Toggle to raw mode (`Cmd/Ctrl+E`) when you want to see the source.
- **Find files instantly.** `Cmd/Ctrl+P` fuzzy palette across your whole folder.
- **Built-in AI assistant.** Chat with Claude Code about the file you're editing, ask it to draft, rewrite, or summarize — it can read and write notes in your folder when you ask.
- **External changes welcome.** Edit a file in another app and mdwriter picks it up automatically.

## Get mdwriter

Download the latest build from the [Releases page](https://github.com/Ryanb58/mdwriter/releases/latest):

- **macOS** — `mdwriter_*_macOS_Silicon.dmg` (Apple Silicon) or `mdwriter_*_macOS_Intel.dmg`
- **Windows** — `mdwriter_*_x64-setup.exe`
- **Linux** — `.AppImage`, `.deb`, or `.rpm`

Open it and pick any folder of Markdown files (or an empty folder to start fresh). That's it.

### First launch

mdwriter isn't signed with a paid Apple or Windows certificate yet, so your OS will warn you the first time. One-time approval:

- **macOS** — double-click `mdwriter.app`. On the "could not verify" warning click **Done**, then open **System Settings → Privacy & Security**, scroll to *"mdwriter.app was blocked"*, and click **Open Anyway**. Normal double-click works after that. (On macOS 14 and earlier, right-click → **Open** also works.)
- **Windows** — on the SmartScreen warning, click **More info → Run anyway**.

## Stays up to date

mdwriter checks for updates about ten seconds after launch. If there's a new version, you'll see a banner in the bottom-right of the window — click **Restart and install** when you're ready. You can also check manually from **mdwriter → Check for Updates…** (macOS) or **Settings → About → Check for Updates** (anywhere).

Update payloads are cryptographically signed, so even though the OS isn't yet signing the app, the app verifies every update against a key it trusts.

## A few handy shortcuts

| Shortcut | Action |
| --- | --- |
| `Cmd/Ctrl+P` | Find a file by name |
| `Cmd/Ctrl+E` | Toggle between block editor and raw Markdown |
| `Cmd/Ctrl+S` | Save (autosave runs every 500ms anyway) |

---

## For developers

mdwriter is built with [Tauri 2](https://tauri.app), React 19, TypeScript, [BlockNote](https://www.blocknotejs.org), and [CodeMirror](https://codemirror.net). Package manager is `pnpm`.

```sh
pnpm install
pnpm tauri dev      # run the full desktop app
pnpm dev            # frontend only, in a browser
pnpm test           # frontend unit tests
pnpm tauri build    # production bundle
```

Releases are cut from the **Release** GitHub Actions workflow — see [`docs/RELEASING.md`](docs/RELEASING.md). Architecture notes for contributors live in [`CLAUDE.md`](CLAUDE.md).
