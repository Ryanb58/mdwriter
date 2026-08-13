# Reference Behavior — VS Code Multi-Window Walkthrough

**Status of this document.** The run was specified against a screen recording of VS Code
performing the walkthrough. No such recording was supplied, and this environment cannot
process video (no `ffmpeg`) or drive a GUI (`osascript` returns `-25211: not allowed
assistive access`). This file is the written substitute: VS Code's observable behavior for
each scenario, stated precisely enough to grade against. Confidence is noted per claim.

Terminology map: VS Code *folder/workspace* → mdwriter *vault*. mdwriter has no tabs, so
each window hosts one vault and one open document.

---

## S1 — Open two workspace windows (Cmd+Shift+N)

| # | Behavior | Confidence |
|---|---|---|
| S1.1 | `Cmd+Shift+N` opens a new window immediately. The existing window is untouched — same folder, same editors, same scroll and dirty state. | High |
| S1.2 | The new window starts empty (no folder) and is independently navigable to any folder. | High |
| S1.3 | Each window has fully independent state: file tree, open editor, search index, watcher. Expanding a folder in B does not expand it in A. | High |
| S1.4 | Window title reflects that window's own folder, not the other's. | High |
| S1.5 | Opening a folder already open in another window focuses that window rather than opening a duplicate. | Medium-High |
| S1.6 | New windows are offset, not stacked exactly on top of the previous window. | Medium |

## S2 — Edit the same file in both windows, save one

This is the scenario with the most specific behavior, and the easiest to get subtly wrong.

| # | Behavior | Confidence |
|---|---|---|
| S2.1 | **Clean receiver:** B's buffer is unmodified, A saves → B silently reloads from disk. No prompt, no dialog. Cursor/scroll position is preserved as far as possible. | High |
| S2.2 | **Dirty receiver:** B has unsaved edits, A saves → B **keeps its dirty buffer**. B does not silently discard the user's work and does not silently reload. | High |
| S2.3 | **Dirty receiver then saves:** B attempts to save after A already wrote → the save is **blocked**, not silently applied. VS Code raises `FILE_MODIFIED_SINCE` by comparing on-disk mtime/etag against what B last read. | High |
| S2.4 | The block surfaces as a notification along the lines of *"Failed to save 'file': The content of the file is newer. Please compare your version with the file contents or overwrite the content of the file with your changes."* offering **Compare** and **Overwrite**. | High (wording approximate) |
| S2.5 | The user can resolve by overwriting (B wins) or comparing (diff view). Neither side loses data without an explicit choice. | High |
| S2.6 | A's own save does not trigger a reload or conflict in A itself (no self-write echo). | High |

**The gradeable core of S2 is 2.1 / 2.2 / 2.3.** Silent clobber of a dirty buffer is the
canonical failure and is the thing to test hardest.

## S3 — Close one window

| # | Behavior | Confidence |
|---|---|---|
| S3.1 | Closing A leaves B entirely functional: folder, editor, dirty state, and **file watching** all still work. A stale watcher must not be torn down for B. | High |
| S3.2 | Closing A releases A's resources (watcher, index). No leak, no orphaned process. | High |
| S3.3 | If A has unsaved changes, only A prompts. B is not involved. | High |
| S3.4 | On macOS the app stays running with zero windows open. | High |

## S4 — Quit and relaunch, both windows restored

| # | Behavior | Confidence |
|---|---|---|
| S4.1 | Quitting with two windows and relaunching restores **both** windows. | High (`window.restoreWindows: "all"`, the macOS default) |
| S4.2 | Each restored window reopens **its own** folder — they are not collapsed into one, and not swapped. | High |
| S4.3 | Each restored window reopens its own previously-open editor. | High |
| S4.4 | Per-window geometry (size and position) is restored. | Medium-High |
| S4.5 | With hot exit (`files.hotExit: "onExit"`, default) unsaved changes survive quit without prompting. | High — but see note |

> **Note on S4.5.** Hot exit is a large feature in its own right (persisting unsaved buffers
> to disk-backed backups). It is out of scope for this run unless the graded piece explicitly
> takes it on. mdwriter today has no session persistence of any kind for the open document.

---

## Scenario → piece mapping

| Scenario | Pieces that must land |
|---|---|
| S1 | P1 per-window state, P2 IPC isolation, P3 window lifecycle |
| S2 | P5 cross-window conflict/reload |
| S3 | P3 window lifecycle (destroy path) |
| S4 | P6 multi-window session restore |

P4 (AgentSession single-owner lock) and P7 (shared-storage hygiene) are ungraded supporting
work — they exist to prevent regressions that the walkthrough would otherwise expose.

## Note on the upstream spec

`multi-window-spec.md` (writer.computer) is the architectural reference for P1–P3, and its
approach is adopted directly: per-window state keyed by Tauri window label, `emit_to`
instead of broadcast `emit`, label-scoped command dispatch. Two divergences:

- Its shipped v1 explicitly **does not** restore multiple windows at quit. S4 has no upstream
  implementation to copy and is genuinely new work.
- It ships with known cross-window races on shared JSON (recents, sessions, global settings)
  which it papers over with file mutexes. P7 should not inherit that debt uncritically.
