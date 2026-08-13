# Multi-Window — Live Progress

**Branch:** `multi-window` · **Worktree:** `../mdwriter-multiwindow` · **Baseline:** 125 Rust tests green

Reference behavior: [`reference-behavior.md`](./reference-behavior.md)

---

## Verification method (degraded — read this)

The run was specified as: critic runs the real app, replays the walkthrough blind against a
VS Code reference recording, names the biggest gap. **Two parts of that are not executable here:**

| Requirement | Status | Substitute in use |
|---|---|---|
| Reference recording of VS Code | **Not supplied.** No video in attachments; no `ffmpeg` to process one. | Written per-scenario behavior spec, derived from VS Code's documented + known behavior, with confidence levels. |
| Critic drives the real app | **Blocked.** `osascript` → `-25211 not allowed assistive access`. No keystroke injection, no window enumeration. | Rust integration tests exercising the real command layer + adversarial code critique against the reference. |

**What would upgrade this:** granting Terminal/T3 accessibility access in
System Settings → Privacy & Security → Accessibility. That unlocks real window
enumeration and keystroke-driven walkthroughs, and critics would switch to it automatically.
Supplying an actual recording would upgrade the reference from written to visual.

Everything below is graded against the written reference, not against pixels.

---

## Pieces

**Tests: 241 Rust** (125 baseline + 116) · **869 frontend** (vitest, 90 files) · clippy clean
(8 warnings, identical count on `main` — none introduced by this branch).

| Piece | Scope | Scenario | Status |
|---|---|---|---|
| P1 | Per-window state container (`AppState` → label-keyed map) | S1 | ✅ won (r2) |
| P2 | IPC isolation (label through commands, `emit` → `emit_to`) | S1 | ✅ cleared by P4 |
| P3 | Window lifecycle (create / Cmd+Shift+N / destroy / cleanup) | S1, S3 | ✅ cleared by P4 |
| P4 | Per-window AI/agent scoping + single-owner lock | S1, S3 | ✅ won (r2) · orphan defect fixed |
| P7 | Scoped persistence (shared vs per-window, 3-way merge) | blocks S4 | ✅ won (r3) · nested-merge defect fixed |
| P5 | Cross-window conflict + reload | **S2** | ✅ won (self-critiqued) — see note below |
| P6 | Multi-window session restore | **S4** | ⏳ next |

### Verification mode changed mid-run — read this

The workspace API usage limit was hit partway through stage 4 (`build:P5` completed;
`critic:P5:r1` errored: *"You have reached your specified workspace API usage limits. You
will regain access on 2026-09-01 at 00:00 UTC."*). That budget resets in ~3 weeks and gates
the `Agent`/`Workflow` tools specifically — not my own direct tool use (`Read`/`Edit`/`Bash`).

Rather than wait three weeks, P5 was reviewed **directly in the main loop** instead of via a
spawned critic: same standard (run both suites myself, trace the actual code paths, don't
credit an unverified claim), just without a second, independently-primed model doing it. That
is a real reduction in rigor — a fresh-context adversarial critic catches things a continuous
session's confirmation bias won't — and it's flagged here rather than presented as equivalent.
**P6 will need the same treatment until the limit clears.**

Legend: ⏳ queued · 🔨 building · 🔍 under critique · 🔁 looping · ✅ won · ⚠️ blocked

### Two decomposition corrections, both made by critics

**P4 was mis-filed as an ungraded regression guard.** Two independent critics — P2 r2 and P3 r2,
neither aware of the other — converged on the unscoped agent channel as the biggest gap in their
own piece. It blocked S1.3 and S3.1/S3.2 and was a privilege leak. Promoted; won in 2 rounds;
S1 and S3 unblocked.

**P7 was mis-characterized as an occasional read-modify-write race.** It is much worse, and the
integration critic proved it: zustand 5.0.13 writes the *entire* `partialize` slice on **every**
`setState` (`node_modules/zustand/middleware.js:365-372` — `api.setState` is wrapped to call
`setItem()` unconditionally), all windows share one `mdwriter:store` key at one origin, and there
is no `storage` listener anywhere in `src/`. So window B typing **one character** discards window
A's settings, pins, and recents. That is continuous last-writer-wins at keystroke frequency, and
no file mutex fixes it. Verified independently before acting. It must land before P6, because
`recentFilesByVault` is exactly what S4's restore reads.

---

## Round log

### Stage 1 — `wf_fee9b73e-de5` · 12 agents · 0 errors · 104 min · 1.44M tokens

**P1 r1 — ✗ FAIL.** *"Nothing in the shipped binary is label-scoped."* All ~15 production call
sites resolved through `shim_window()` to the hardcoded label `"main"`; `remove`/`find_by_vault`
were `#[allow(dead_code)]`. Proved it with a live probe: window B's own file was rejected because
validation ran against window A's vault. Also proved a zombie-watcher resurrection bug — a late
`get_or_create` after `remove` recreated the label with a live watcher nothing would ever drop.
→ Fixed: shim deleted, real labels threaded, `remove` made final.

**P1 r2 — ✓ WON.** 156 tests. Isolation verified real, not shimmed; `remove` proven to release
FSEvents via a `Weak` upgrade-fails test; no deadlock under 8×200 concurrent ops. Carried forward
a deep finding: `emit_to` is a **no-op for isolation** unless the receiver opts in, because a bare
`listen()` registers `EventTarget::Any` and Tauri's `match_any_or_filter` short-circuits on it.
Emitter-side fixes alone would have changed nothing. → produced `src/lib/windowEvents.ts`.

**P2 r1 — ✗ FAIL.** `start_ai_session` took no window param and passed frontend-supplied
`vault_path` straight to `.current_dir()` unvalidated — window B could run an LLM agent with write
access inside window A's vault, the exact attack the other 23 commands guard against.
→ Fixed: now takes `window` + `state` and gates through `ensure_within_active_vault`.

**P2 r2 — ✗ FAIL.** The AI channel is still broadcast in *both* directions, and it is a privilege
leak: window A starts an agent scoped to vault A, but the approval card for a tool call writing
into vault A pops in window B, where a user with no scope over vault A can approve it.
→ Deferred to P4, now promoted.

**P3 r1 — ✗ FAIL.** *"On macOS the destroy path never runs."* `useAutoSave.ts` registered an
`onCloseRequested` handler that `preventDefault()`s and then `hide()`s on macOS — and Tauri
auto-prevents the close whenever such a listener exists, so `Destroyed` never fired and P3's whole
teardown was dead code on the primary platform. → Fixed: Rust now owns the decision via a
`closeWindow` command (only the backend can count live windows), destroying all but the last.

**P3 r2 — ✗ FAIL.** Closing a window doesn't shut down its agent subprocess: `claude` keeps
running with cwd in a now-unclaimed vault, and its output streams into the surviving window
mid-conversation. → P4.

### Stage 2 — `wf_6fb6ab6b-28a` · 5 agents · 0 errors · 45 min · 657k tokens

**P4 r1 — ✗ FAIL** → fixed. **P4 r2 — ✓ WON.** 229 Rust / 798 frontend. Critic verified the whole
chain rather than the parts: zero bare `.emit(` left in production; every window-scoped listener on
`listenForThisWindow`; ownership gates on `respond_permission` / `add_permission_rule` /
`stop_ai_session` proven through **real IPC** (`tauri::test::get_ipc_response` against the actual
`generate_handler`), including the inverse assertion that the owner still gets through so the gate
isn't just refusing everybody. Confirmed the lock cannot wedge: stale owners reaped in both
directions, `release()` label-guarded so a superseded waiter can't unlock a newer owner, and both
destroy paths ordered shutdown-then-release.

> **Harness gap I need to own.** This critic set `passes=true` *while* reporting an empirically
> reproduced defect (below). My loop breaks on `passes && testsGreen`, so it exited with a known
> live bug. The pass/fail bit and "biggest remaining gap" shouldn't be independent — a confirmed
> defect on a graded row should force another round. Fixing the defect in stage 3 by hand.

**P4 confirmed defect (now being fixed):** `start_ai_session` steals the lock from a stale owner
but defers the kill to `spawn_claimed_session`, so when `prepare_agent` fails *after* the steal,
the `Claim::Acquired` arm releases the lock without reaping the dead owner's child. Probe:
`owner after failed steal: None / ghost child still running: true / stop_ai_session from b: Ok(Null)
/ ghost child running after stop: true`. Owner is `None`, so `owns_session` returns false, so
`stop_ai_session` is a silent no-op from every window — the orphan is unreachable from any UI.
Violates S3.2. `owns_session` already reaps in this exact state; the start path is the asymmetry.

**Integration critic (S1 + S3) — ✗ FAIL**, on P7 rather than on anything in S1/S3 itself. S1 rows
came back proven-by-test for the state half (`open_new_window_adds_a_window_without_disturbing_the_existing_one`,
`open_new_window_twice_yields_two_distinct_windows`) and proven-by-reading for the menu wiring,
with the never-created-window label leak explicitly closed at `window_lifecycle.rs:306-314`.

### Stage 3 — `wf_deb2349a-411` · 7 agents · 0 errors · 73 min · 773k tokens

P4 orphan defect fixed. **P7 — ✓ WON at r3** (230 Rust / 844 frontend). Shape of the fix: persisted
keys split by scope (`shared` vs `window`), three-way merge against a base ancestor, write-only-what-
changed dedup, and a Tauri-event resync — deliberately *not* the browser `storage` event, which
`sharedPersistSync.ts:22-25` explicitly refuses to bet on for cross-WKWebView delivery.

The r3 critic traced interleavings by hand in both orders and confirmed convergence holds **even if
the broadcast is lost**, checked merge idempotency (`f(mine,f(mine,disk,base),base) == f(mine,disk,base)`),
and ran 50 microtask ticks looking for ping-pong. It also confirmed the two-realm test harness is
real — one shared `Map`, two independent storage instances — rather than a single-store fake.

> **Harness gap, second occurrence — now fixed.** This critic *also* set `passes=true` while
> reporting a reproduced defect, exactly as P4's did, and my loop shipped it again. The schema now
> carries a required `reproducedDefect` flag and the loop gate is
> `passes && testsGreen && !reproducedDefect`. A critic can no longer pass a piece it has just
> demonstrated is broken.

**P7 defect (verified independently, now in fix):** `store.ts:538` resolves `recentFilesByVault`
with the per-*key* `mergeRecords` while `pinnedPaths` correctly uses the per-*list* `mergeStringSets`.
Two windows on one vault → A opens `a.md`, B opens `b.md` → disk ends `{"/v":["/v/b.md","/v/orig.md"]}`
and `a.md` is gone. `restoreLastFile` reads index `[0]`, so **window A restores window B's document
on relaunch** — a graded S4 failure. Reachable because `vaultWindow()` swallows lookup errors and
returns `null` (`useFolderPicker.ts:47-53`), producing the very two-windows-one-vault state that
opens the hole.

**Known limitation, not yet fixed — needs a decision.** Web Storage has no compare-and-swap, so
`setItem`'s read-modify-write is not atomic across processes. The critic injected a write between
another realm's read and write and lost a `theme: "dark"` change *unrecoverably* — the losing side's
next write sees `mine === base` and adopts the value that clobbered it. The honest fix is arbitrating
shared prefs in Rust. P6 will be building Rust-side session storage anyway, so that is the natural
place to absorb it — flagged rather than silently bundled.

### Stage 4 — `wf_ba59d131-3ea` · 1 agent done, 2 errored on quota · then hand-reviewed

P7's nested-merge defect fixed (per-list merge for `recentFilesByVault`, matching `pinnedPaths`).
`build:P5` completed before the quota hit and produced a real save-precondition implementation:
- `src-tauri/src/commands/fs.rs`: `write_file` takes an `expected_digest`; `write_checked` hashes
  disk content (FNV-1a over the bytes, not mtime — the doc comment explicitly reasons through why
  mtime granularity would be unsafe) and refuses with `AppError::SaveConflict` on mismatch. A
  per-path in-process `Mutex` closes the TOCTOU window between check and write for the case that
  matters (two windows, one process); a write from a foreign process between check and rename is
  explicitly and correctly documented as an open gap "VS Code has the same gap," not silently
  assumed away.
- `src/lib/writeDoc.ts`: a save coordinator that parks automatic saving on a conflicted path
  (`conflictPath`) instead of retrying an identical write against an identical disk state every
  500ms debounce.
- `src/features/editor/SaveConflictDialog.tsx`: wired into `App.tsx`, offers Overwrite / Discard-
  and-reload / Keep-editing — an honest substitute for VS Code's Compare (no diff view exists;
  the absence is documented rather than silently dropped), and satisfies S2.5 (neither version
  disappears without an explicit choice).
- `useExternalChanges.ts`'s existing dirty-guard was reused unmodified for S2.2 — a dirty receiver
  already never reloads out from under the user; that logic predates this piece.

**Defect found and fixed on inspection (2 failing frontend tests left by the interrupted run):**
`editOpenDoc` (`store.ts:1023`) reset `saveStatus` to `"queued"` on every keystroke with no
exception for `"conflict"` — so a user typing after a blocked save watched the conflict indicator
silently vanish (implying a save would happen) while the coordinator correctly kept it parked
underneath. Root-caused by reading the reducer against the two failing test names, fixed to
preserve `saveStatus`/`saveError` when the prior status was `"conflict"` (mirroring the existing
`"saving"` exception), reverified: 241 Rust / 860 frontend, both green.

**Self-critique findings (S2.1–S2.6) — all closed:**

- **Production path is genuinely wired, not just test-green.** The failure mode that sank P1 and P3
  was a fix that passed its tests while the shipped path was untouched, so that was checked first
  here: `useOpenFile.ts:108` threads `snapshot.digest` into the store on every real open, and the
  *sole* `ipc.writeFile` caller (`writeDoc.ts:200`) passes `preconditionFor()`. S2.3 is live in the
  binary.
- **S2.1 / S2.2 hold.** `useExternalChanges.ts` re-validates against a live doc snapshot *after* its
  async read, closing the race where the user starts typing while Rust is reading. A dirty buffer is
  never reloaded out from under the user.
- **S2.3 holds against both attacks that sank earlier pieces.** Content hash, not mtime (the code
  reasons through mtime granularity explicitly). Check-then-write is serialized by a per-path
  in-process `Mutex`, which closes the TOCTOU window for the two-windows-one-process case this
  feature exists for. The foreign-process gap is documented as open rather than assumed away.
- **S2.6 holds.** `preconditionFor` reads the digest live and a successful write advances it, so a
  window cannot conflict against its own previous save.
- **Narrow hole checked and found acceptable:** `preconditionFor` returns `null` (unconditional
  write) when the coordinator finishes work for a path the store has moved off. Traced the real
  navigation path — `useOpenFile.ts:93-103` flushes *while the old path is still current* and calls
  `restoreSourceSelection()` if that flush rejects, so navigation cannot strand a conflict or
  silently drop the precondition.

**Gap closed:** added `src/features/editor/__tests__/SaveConflictDialog.test.tsx` (9 tests) covering
the dialog wiring the coordinator tests cannot see — both resolution directions, dismiss-is-not-
resolve, Escape-is-not-resolve, and a failed resolution leaving the conflict live.

> **The new tests were mutation-checked, and one was wrong.** A first pass asserted "does not fire a
> resolution twice on a double click" and passed — but survived deleting the `if (busy) return`
> guard, because React re-renders the button `disabled` before the second click lands. The test was
> verifying a real property under a false name. Rewritten to assert the actual user-visible
> mechanism (all three buttons inert mid-flight, including the *opposite* resolution — clicking
> Discard during an in-flight Overwrite would run both against one conflict), and re-mutated to
> confirm it now fails when the guard is removed.

---

## Open risks

1. **S4 has no upstream reference implementation.** writer.computer's shipped v1 explicitly
   skips multi-window session restore. P6 is new work, highest uncertainty.
2. **Build cost.** Tauri debug target dir is ~14 GB. Builders share one worktree and one
   target dir; Rust builds serialize on the cargo lock rather than running cold in parallel.
3. **AI subprocess is still a process-wide singleton, now with an explicit owner.** P4 scopes its
   events and commands to the owning window and refuses a second window's start with a typed
   `AgentBusy` (which the panel turns into "busy in <vault> → Focus"). What it does *not* do is let
   two windows run agents at once — that needs one `AgentSession` per label plus per-session
   brokers, and is a larger change than the leak it would close.
