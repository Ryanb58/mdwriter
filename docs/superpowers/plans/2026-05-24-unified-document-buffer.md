# Unified Document Buffer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the split `{ frontmatter: object, rawMarkdown: body }` model with a single canonical `text: string` document buffer, so the editor, properties panel, raw view, and disk all reference the same bytes.

**Architecture:** The on-disk file is the canonical document. The store holds one `text` field equal to the file's contents. All "views" (block editor body, properties panel, raw editor) derive from `text` via pure helper functions and write back through a single coordinator. Frontmatter is a parsed *view* over a `[start, end)` slice of `text`, not a separate state field. The Rust read/write commands move bytes — they do not parse and re-emit them.

**Why this fixes things:**
- Removes the `combineRaw` / `parseRaw` reconstruction that silently reformats user YAML.
- Eliminates the two-YAML-parser drift (`gray_matter` in Rust vs. `parseSimpleYaml` in TS).
- Removes the lossy round-trip whenever the user only edits frontmatter or only edits body — bytes outside the edited region are preserved verbatim.
- Centralizes writes through one orchestrator so `noteSelfWrite` / `cancelPendingDocSave` / `bumpDocRev` aren't scattered across callers.
- Replaces the 1-second `RECENT_WRITE_WINDOW_MS` heuristic with content-hash echo detection.
- Suppresses BlockNote re-emit echoes that don't change body bytes.

**Tech Stack:** TypeScript 5 / React 19 / Zustand / BlockNote / CodeMirror / Rust (Tauri 2) / Vitest / cargo test

**Branch:** `copilot/fix-block-note-cursor-alignment` (continues here per user direction)

---

## File Structure

### New files
- `src/lib/doc.ts` — pure helpers: `parseDoc(text)`, `getBody(text)`, `setBody(text, body)`, `getFrontmatterValues(text)`, `setFrontmatterField(text, k, v)`, `removeFrontmatterField(text, k)`. **No state.** All operations are pure string → string.
- `src/lib/doc.test.ts` — characterization + invariant tests for the above.
- `src/lib/writeDoc.ts` — `writeOpenDoc(path, text)` coordinator: tracks self-writes, cancels pending autosaves, bumps doc rev, performs the IPC write. The single allowed write path for the open document.
- `src-tauri/src/commands/file_meta.rs` — `read_file_text(path) -> FileRead`, `write_file_text(path, text) -> WriteAck` with `{ text, mtime_ms, hash }` and `{ mtime_ms, hash }` shapes. Hash is xxh3.

### Modified files (Rust)
- `src-tauri/src/commands/fs.rs` — `read_file` becomes `read_file_text` (returns `{ text, mtime_ms, hash }`); `write_file` becomes `write_file_text` (accepts `text: String`, returns `{ mtime_ms, hash }`). Old `ParsedDoc` signatures removed.
- `src-tauri/src/commands/frontmatter.rs` — `parse_doc` / `serialize_doc` retained only for internal callers that still need structured frontmatter access (currently: none in the new model). Marked dead-code or removed in Phase 7.
- `src-tauri/src/lib.rs` — register new command names.

### Modified files (TypeScript)
- `src/lib/ipc.ts` — `readFile` returns `{ text, mtime, hash }`; `writeFile(path, text)` returns `{ mtime, hash }`.
- `src/lib/store.ts` — `OpenDoc` becomes `{ path, text, dirty, savedAt, diskVersion, parseError }`. `frontmatter` and `rawMarkdown` fields deleted.
- `src/features/editor/useOpenFile.ts` — populates `text` from `readFile`.
- `src/features/editor/useAutoSave.ts` — uses `writeOpenDoc` coordinator; routes through hash echo-detection.
- `src/features/editor/useEditorMode.ts` — `toggle()` is now a pure view switch (no parse/combine).
- `src/features/editor/useAutoRename.ts` — `extractFirstH1(doc.text)` (helper handles frontmatter strip).
- `src/features/editor/renameOpenDoc.ts` — uses `writeOpenDoc` coordinator instead of direct `ipc.writeFile`.
- `src/features/editor/EditorPane.tsx` — `BlockEditor` receives `getBody(doc.text)`; onChange goes through `setBody(text, body)` then `patchOpenDoc({ text })`.
- `src/features/editor/BlockEditor.tsx` — `onChangeMarkdown` receives a body string; the *guard* added: if `getBody(currentText) === newBody`, suppress the patch entirely (no dirty bit set). This is the BlockNote idempotent emit guard.
- `src/features/editor/RawEditor.tsx` — binds to `doc.text` directly.
- `src/features/properties/PropertiesPane.tsx` — `setField` calls `patchOpenDoc({ text: setFrontmatterField(text, k, v) })`. `entries` reads `getFrontmatterValues(text)`.
- `src/features/ai/applyToNote.ts` — all branches mutate `text` (with the slice being body-only for `replace-selection` / `append`, the whole file for `replace-all`).
- `src/features/watcher/useExternalChanges.ts` — uses content hash (from `FileRead`) for echo-detection. The recent-self-write Map remains as a *fast-path*; the hash is the source of truth.
- `src/features/folder/useFolderPicker.ts`, `src/features/tree/moveExecutor.ts`, `src/features/tree/useTreeActions.ts` — any code that constructs an `OpenDoc` adopts the new shape.

### Test files
- `src/lib/__tests__/doc.test.ts` (new)
- `src-tauri/src/commands/file_meta_tests.rs` (new — Rust unit tests for round-trip preservation)
- All existing test files for the touched modules.

---

## Execution Notes

**Branch strategy:** All work happens on `copilot/fix-block-note-cursor-alignment`. One commit per phase. Each commit must leave `pnpm test`, `cargo test --manifest-path src-tauri/Cargo.toml --lib`, and `pnpm tsc --noEmit` green.

**Review gates:** After Phases 2, 5, and 9 — request human review (via the `superpowers:requesting-code-review` skill) before continuing.

**Migration order:** Phases 1–6 deliver the architectural fix. Phases 7–9 add reliability and are independently mergeable.

---

## Phase 1: Pure document helpers (no wiring)

### Task 1: Create `src/lib/doc.ts` with pure helpers

**Files:**
- Create: `src/lib/doc.ts`
- Test: `src/lib/__tests__/doc.test.ts`

- [ ] **Step 1: Write failing tests for `parseDoc`**

```ts
// src/lib/__tests__/doc.test.ts
import { describe, expect, it } from "vitest"
import { parseDoc, getBody, setBody, getFrontmatterValues, setFrontmatterField, removeFrontmatterField } from "../doc"

describe("parseDoc", () => {
  it("returns empty frontmatter for a file with no frontmatter", () => {
    const r = parseDoc("# Hello\n")
    expect(r.frontmatterRange).toBeNull()
    expect(r.values).toEqual({})
    expect(r.body).toBe("# Hello\n")
  })

  it("identifies frontmatter range and parses values", () => {
    const text = "---\ntitle: T\ncount: 3\nflag: true\n---\n\n# Body\n"
    const r = parseDoc(text)
    expect(r.frontmatterRange).toEqual({ start: 0, end: text.indexOf("---\n\n") + 4 })
    expect(r.values).toEqual({ title: "T", count: 3, flag: true })
    expect(r.body).toBe("# Body\n")
  })

  it("preserves array values", () => {
    const text = "---\ntags:\n  - a\n  - b\n---\n\nbody"
    const r = parseDoc(text)
    expect(r.values).toEqual({ tags: ["a", "b"] })
  })

  it("returns parseError for malformed frontmatter without crashing", () => {
    const text = "---\n: bad\n---\nbody"
    const r = parseDoc(text)
    expect(r.parseError).toBeTruthy()
    expect(r.body).toBe("body") // body still recoverable
  })
})

describe("getBody / setBody", () => {
  it("getBody returns text minus frontmatter region", () => {
    const text = "---\nt: 1\n---\n\n# B\n"
    expect(getBody(text)).toBe("# B\n")
  })

  it("setBody preserves frontmatter region byte-for-byte", () => {
    const text = "---\nt: 1\n# inline comment kept by gray_matter\n---\n\n# old body\n"
    const next = setBody(text, "# new body\n")
    expect(next.startsWith("---\nt: 1\n# inline comment kept by gray_matter\n---\n\n")).toBe(true)
    expect(next.endsWith("# new body\n")).toBe(true)
  })

  it("setBody on a file with no frontmatter just replaces text", () => {
    expect(setBody("# old", "# new")).toBe("# new")
  })
})

describe("setFrontmatterField / removeFrontmatterField", () => {
  it("updates a scalar field without touching other fields", () => {
    const text = "---\ntitle: Old\ncount: 3\n---\n\nbody"
    const next = setFrontmatterField(text, "title", "New")
    expect(parseDoc(next).values).toEqual({ title: "New", count: 3 })
    expect(getBody(next)).toBe("body")
  })

  it("adds a new field to a file with frontmatter", () => {
    const text = "---\ntitle: T\n---\n\nbody"
    const next = setFrontmatterField(text, "tags", ["a"])
    expect(parseDoc(next).values).toEqual({ title: "T", tags: ["a"] })
  })

  it("adds frontmatter region when file had none", () => {
    const text = "# Just body\n"
    const next = setFrontmatterField(text, "title", "T")
    expect(parseDoc(next).values).toEqual({ title: "T" })
    expect(getBody(next)).toBe("# Just body\n")
  })

  it("removes a field, leaving others", () => {
    const text = "---\ntitle: T\ntags:\n  - a\n---\n\nbody"
    const next = removeFrontmatterField(text, "tags")
    expect(parseDoc(next).values).toEqual({ title: "T" })
  })

  it("removing the last field removes the entire frontmatter block", () => {
    const text = "---\ntitle: T\n---\n\nbody"
    const next = removeFrontmatterField(text, "title")
    expect(parseDoc(next).frontmatterRange).toBeNull()
    expect(getBody(next)).toBe("body")
  })
})

describe("invariant: body bytes are preserved when only frontmatter changes", () => {
  it("body byte-equal after multiple frontmatter mutations", () => {
    const body = "# H\n\nA line with **bold**.\n\n- item 1\n- item 2\n"
    let text = `---\nfoo: 1\n---\n\n${body}`
    text = setFrontmatterField(text, "foo", 2)
    text = setFrontmatterField(text, "bar", "x")
    text = removeFrontmatterField(text, "foo")
    expect(getBody(text)).toBe(body)
  })
})

describe("invariant: frontmatter bytes are preserved when only body changes", () => {
  it("frontmatter region byte-equal after body edits", () => {
    const fmRegion = "---\nfoo: 1\ntags:\n  - x\n  - y\n---\n\n"
    let text = `${fmRegion}# Old`
    text = setBody(text, "# New body\n\nLine.\n")
    expect(text.startsWith(fmRegion)).toBe(true)
  })
})
```

Run: `pnpm test -- src/lib/__tests__/doc.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 2: Implement `src/lib/doc.ts`**

```ts
// src/lib/doc.ts
/**
 * Pure helpers over the canonical document text. `text` is the full file
 * contents — frontmatter (if any) is a `[start, end)` byte slice; everything
 * after is the body. All mutations are string → string; no state.
 */

export type ParsedDoc = {
  /** `[start, end)` of the frontmatter region (including the `---\n` fences and trailing blank line) or `null` if absent. */
  frontmatterRange: { start: number; end: number } | null
  /** Parsed scalar/array values from the YAML region. Empty object if no FM. */
  values: Record<string, unknown>
  /** The body slice — i.e. `text.slice(frontmatterRange?.end ?? 0)`. */
  body: string
  /** YAML parse error (if any). When set, `values` is best-effort and may be empty. */
  parseError: string | null
}

// Match an opening `---\n`, then any YAML up to a closing `---` on its own
// line, then optionally a single `\n` after the closing fence. Multiline
// flag, dotall via [\s\S].
const FM_RE = /^---\n([\s\S]*?\n)---(?:\r?\n)?/

export function parseDoc(text: string): ParsedDoc {
  const m = text.match(FM_RE)
  if (!m) return { frontmatterRange: null, values: {}, body: text, parseError: null }
  const end = m[0].length
  const yamlSrc = m[1]
  let values: Record<string, unknown> = {}
  let parseError: string | null = null
  try {
    values = parseSimpleYaml(yamlSrc)
  } catch (e) {
    parseError = e instanceof Error ? e.message : String(e)
  }
  // Skip *one* leading newline after the closing fence so the body
  // section is conventional (no blank line at the top).
  const bodyStart = text[end] === "\n" ? end + 1 : end
  return {
    frontmatterRange: { start: 0, end: bodyStart },
    values,
    body: text.slice(bodyStart),
    parseError,
  }
}

export function getBody(text: string): string {
  return parseDoc(text).body
}

export function setBody(text: string, body: string): string {
  const r = parseDoc(text)
  if (!r.frontmatterRange) return body
  return text.slice(0, r.frontmatterRange.end) + body
}

export function getFrontmatterValues(text: string): Record<string, unknown> {
  return parseDoc(text).values
}

export function setFrontmatterField(text: string, key: string, value: unknown): string {
  const r = parseDoc(text)
  const next = { ...r.values, [key]: value }
  return rebuild(next, r.body, r.frontmatterRange !== null)
}

export function removeFrontmatterField(text: string, key: string): string {
  const r = parseDoc(text)
  if (!(key in r.values)) return text
  const next = { ...r.values }
  delete next[key]
  return rebuild(next, r.body, r.frontmatterRange !== null)
}

function rebuild(values: Record<string, unknown>, body: string, hadFm: boolean): string {
  const keys = Object.keys(values)
  if (keys.length === 0) {
    // No fields → drop the frontmatter block. Keep the body verbatim;
    // the leading blank line conventionally separating FM from body is
    // gone, so any existing leading whitespace in body stands.
    return body
  }
  const yaml = keys.map((k) => formatYamlKv(k, values[k])).join("\n")
  const sep = hadFm ? "" : ""
  void sep
  // Always emit `---\n<yaml>\n---\n\n<body>` so reads see a canonical region.
  return `---\n${yaml}\n---\n\n${body.replace(/^\n+/, "")}`
}

function formatYamlKv(key: string, value: unknown): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return `${key}: []`
    const items = value.map((v) => `  - ${yamlScalar(v)}`).join("\n")
    return `${key}:\n${items}`
  }
  if (value === null || value === undefined) return `${key}: null`
  return `${key}: ${yamlScalar(value)}`
}

function yamlScalar(v: unknown): string {
  if (typeof v === "string") {
    if (/[:#\-]|^\s|\s$/.test(v)) return JSON.stringify(v)
    return v
  }
  if (typeof v === "number" || typeof v === "boolean") return String(v)
  if (v === null || v === undefined) return "null"
  return JSON.stringify(v)
}

// Tiny YAML subset parser: scalars (string/number/bool/null), one-level
// bullet arrays. Mirrors `parseSimpleYaml` in useEditorMode.ts so we have
// one implementation. Throws on malformed lines so the caller can surface
// a parse error.
function parseSimpleYaml(yaml: string): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const lines = yaml.split("\n")
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim() || line.trim().startsWith("#")) { i++; continue }
    const kv = line.match(/^(\S+):\s*(.*)$/)
    if (!kv) throw new Error(`Unparseable line: ${JSON.stringify(line)}`)
    const [, key, valueRaw] = kv
    const value = valueRaw.trim()
    if (value === "") {
      const items: unknown[] = []
      i++
      while (i < lines.length && /^\s+-\s/.test(lines[i])) {
        items.push(parseScalar(lines[i].replace(/^\s+-\s/, "")))
        i++
      }
      out[key] = items
      continue
    }
    out[key] = parseScalar(value)
    i++
  }
  return out
}

function parseScalar(s: string): unknown {
  s = s.trim()
  if (s === "null" || s === "~") return null
  if (s === "true") return true
  if (s === "false") return false
  if (/^-?\d+$/.test(s)) return parseInt(s, 10)
  if (/^-?\d+\.\d+$/.test(s)) return parseFloat(s)
  if (s.startsWith('"') && s.endsWith('"')) return JSON.parse(s)
  return s
}
```

Run: `pnpm test -- src/lib/__tests__/doc.test.ts`
Expected: PASS (all 11 tests)

- [ ] **Step 3: Run full test suite to verify no regressions**

Run: `pnpm test`
Expected: PASS (all existing tests + new ones)

- [ ] **Step 4: Commit**

```bash
git add src/lib/doc.ts src/lib/__tests__/doc.test.ts
git commit -m "feat(doc): introduce pure text-buffer helpers

Adds parseDoc/getBody/setBody/setFrontmatterField/removeFrontmatterField
in src/lib/doc.ts. No production wiring yet — these are the substrate
for the unified-buffer migration."
```

---

## Phase 2: Add `text` field to OpenDoc (additive, no behavior change)

### Task 2: Carry `text` alongside existing fields

**Files:**
- Modify: `src/lib/store.ts:7-15` — extend `OpenDoc` shape
- Modify: `src/features/editor/useOpenFile.ts:20-48` — populate `text`
- Modify: `src/features/watcher/useExternalChanges.ts:74-83` — populate `text` on reload
- Modify: `src/features/ai/applyToNote.ts` — keep `text` in sync when `rawMarkdown`/`frontmatter` change
- Test: `src/lib/__tests__/store.test.ts` (new — minimal store-shape test)

- [ ] **Step 1: Add `text: string` to `OpenDoc`**

In `src/lib/store.ts`, add `text: string` to the `OpenDoc` type. Initialize to empty string in any default-construction.

- [ ] **Step 2: Populate `text` from `combineRaw(frontmatter, body)` in `useOpenFile`**

Change `setOpenDoc({...})` to also include `text: combineRaw(fm, parsed.body)`.

- [ ] **Step 3: Populate `text` in `handleVaultChange` reload path**

Same as Step 2 inside `handleVaultChange`.

- [ ] **Step 4: Keep `text` in sync in `applyToOpenDoc`**

In each branch where `rawMarkdown` is patched, also patch `text` with `combineRaw(frontmatter, next)`.

- [ ] **Step 5: Run tests + typecheck**

```bash
pnpm tsc --noEmit
pnpm test
```
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git commit -am "refactor(store): add OpenDoc.text alongside frontmatter+body

Additive only. text is computed from combineRaw(frontmatter, body) at
every site that constructs an OpenDoc. Next phase migrates readers to
text; final phase removes the split fields."
```

---

## Phase 3: Migrate Raw editor to bind to `text`

### Task 3: Raw editor reads/writes `text`, not `combineRaw(...)`

**Files:**
- Modify: `src/features/editor/EditorPane.tsx:79-85` — pass `doc.text`
- Modify: `src/features/editor/useEditorMode.ts:8-31` — toggle is a pure view switch

- [ ] **Step 1: Change `RawEditor`'s `value` and `onChange` props**

`EditorPane.tsx`: `<RawEditor value={doc.text} onChange={(t) => patch({ text: t, dirty: true })} />`

- [ ] **Step 2: Strip the parse/combine dance from `useEditorMode.toggle`**

```ts
async function toggle() {
  const doc = useStore.getState().openDoc
  if (!doc) return
  setMode(mode === "block" ? "raw" : "block")
}
```

Delete the `combineRaw` / `parseRaw` calls. Frontmatter + body are now always derived from `text` on read.

- [ ] **Step 3: Manual smoke test**

```bash
pnpm tauri dev
```

In the app:
1. Open a file with frontmatter.
2. Toggle raw (⌘E).
3. Toggle back.
4. Verify file contents unchanged on disk (`git diff` should be empty for the test file).

- [ ] **Step 4: Run tests**

```bash
pnpm test
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit -am "refactor(editor): raw editor binds to OpenDoc.text

Removes the combineRaw/parseRaw round-trip on raw-mode toggle. The raw
editor now shows and edits the canonical text buffer directly; toggling
modes is a pure view switch."
```

---

## Phase 4: Migrate Properties panel to write via `text`

### Task 4: Properties reads/writes through `setFrontmatterField`

**Files:**
- Modify: `src/features/properties/PropertiesPane.tsx:27-44`

> **CRITICAL: mirror writes to the legacy `frontmatter` field through Phase 5.** Until Phase 6 deletes the legacy fields, `useAutoSave` still reads `doc.frontmatter` + `doc.rawMarkdown` to persist. A Properties edit that only updates `text` would be silently lost on save. Every patch through this phase MUST set both `text` AND `frontmatter` consistently.

- [ ] **Step 1: Read entries from `getFrontmatterValues(doc.text)`**

```ts
const values = getFrontmatterValues(doc.text)
const entries = Object.entries(values)
```

- [ ] **Step 2: Replace `setField` / `removeField` / `addField` to write via `text`**

```ts
function setField(k: string, v: unknown) {
  const nextText = setFrontmatterField(doc!.text, k, v)
  patch({ text: nextText, frontmatter: getFrontmatterValues(nextText), dirty: true })
}
function removeField(k: string) {
  const nextText = removeFrontmatterField(doc!.text, k)
  patch({ text: nextText, frontmatter: getFrontmatterValues(nextText), dirty: true })
}
function addField() {
  const name = draftName.trim()
  if (!name) { setAdding(false); return }
  if (name in values) { setAdding(false); setDraftName(""); return }
  const nextText = setFrontmatterField(doc!.text, name, "")
  patch({ text: nextText, frontmatter: getFrontmatterValues(nextText), dirty: true })
  setAdding(false)
  setDraftName("")
}
```

- [ ] **Step 3: Run test suite (properties tests still pass)**

```bash
pnpm test -- src/features/properties
```
Expected: PASS

- [ ] **Step 4: Manual smoke test**

In the app:
1. Open a file. Add a property field. Verify file YAML updated.
2. Remove a field. Verify file YAML updated.
3. Toggle raw — verify the YAML in raw view matches what's on disk.

- [ ] **Step 5: Commit**

```bash
git commit -am "refactor(properties): edit YAML region of text directly

PropertiesPane no longer reads/writes a separate frontmatter object.
All mutations go through setFrontmatterField/removeFrontmatterField on
the canonical text, then patch the store. The body region of text is
preserved verbatim — frontmatter changes can no longer cause body
reformat."
```

---

## Phase 5: Migrate BlockEditor to body slice of `text`

### Task 5: BlockEditor reads body of text and writes body back

**Files:**
- Modify: `src/features/editor/EditorPane.tsx:72-78`
- Modify: `src/features/editor/BlockEditor.tsx:30-37, 289-298` — onChange compares to current body before patching

- [ ] **Step 1: EditorPane passes `getBody(doc.text)` as initialMarkdown**

> **CRITICAL: mirror to `rawMarkdown` through Phase 5.** Same reason as Phase 4 — autosave still reads `rawMarkdown` until Phase 6.

```tsx
<BlockEditor
  docKey={`${doc.path}#${docRev}`}
  initialMarkdown={getBody(doc.text)}
  onChangeMarkdown={(body) => {
    const cur = useStore.getState().openDoc
    if (!cur) return
    if (getBody(cur.text) === body) return // idempotent emit guard
    const nextText = setBody(cur.text, body)
    patch({ text: nextText, rawMarkdown: body, dirty: true })
  }}
/>
```

Also migrate the word count display at `EditorPane.tsx:59`:

```tsx
<span className="text-[11px] text-text-subtle">{wordCount(getBody(doc.text))} words</span>
```

- [ ] **Step 2: Remove `combineRaw` import + call from useEditorMode (already done in Phase 3, verify)**

- [ ] **Step 3: Run tests**

```bash
pnpm test
```
Expected: PASS

- [ ] **Step 4: Manual smoke test**

In the app:
1. Open a file with frontmatter.
2. Type in BlockEditor body. Verify file body updates and YAML frontmatter is BYTE-FOR-BYTE preserved (use `git diff` on the test file).
3. Verify "external change" reload doesn't fight typing.

- [ ] **Step 5: Commit**

```bash
git commit -am "refactor(editor): BlockEditor edits body slice of text

The block editor now receives and emits the body portion only; the
frontmatter region is never touched by BlockNote's lossy round-trip.
Adds an idempotent emit guard: re-emits that produce the same body
string suppress the patch entirely (eliminates editor → save → reload
echoes for purely structural BlockNote renders)."
```

---

## Phase 6: Remove split storage from OpenDoc

### Task 6: Delete `frontmatter` and `rawMarkdown` fields

**Files:**
- Modify: `src/lib/store.ts:7-15` — slim `OpenDoc` shape
- Modify: `src/lib/yaml.ts` — delete `combineRaw` (no longer used)
- Modify: `src/features/editor/useEditorMode.ts` — delete `parseRaw` + `parseSimpleYaml` (no longer used)
- Modify: every site that referenced `doc.frontmatter` or `doc.rawMarkdown` (from grep audit)

- [ ] **Step 1: Run grep to enumerate remaining references**

```bash
grep -rn "doc\.frontmatter\|openDoc\.frontmatter\|\.rawMarkdown" src --include="*.ts" --include="*.tsx"
```

Expected: Several call sites still using the legacy fields. Update each.

- [ ] **Step 2: Migrate each remaining call site**

Common patterns:
- `doc.rawMarkdown` → `getBody(doc.text)`
- `doc.frontmatter` → `getFrontmatterValues(doc.text)`
- `combineRaw(doc.frontmatter, doc.rawMarkdown)` → `doc.text`

Notable callers:
- `useAutoRename.ts` — `extractFirstH1(doc.text)` (helper already strips frontmatter internally, no change needed in helper logic)
- `useAutoSave.ts` — writes `doc.text`, not `{frontmatter, body}`
- `renameOpenDoc.ts` — writes `doc.text`
- `useExternalChanges.ts` — compares `reparsed.text === doc.text` for echo detection
- `applyToNote.ts` — operates on body slice for `append` and `replace-selection` (preserve frontmatter), and on body slice for `replace-all` too (the AI is generating a body — frontmatter is metadata it shouldn't blow away). Concretely:
  - `replace-all`: `setBody(doc.text, op.markdown)`
  - `append`: `setBody(doc.text, currentBody + tail + op.markdown)` where `currentBody = getBody(doc.text)`
  - `replace-selection`: search for selection in `getBody(doc.text)`, splice replacement, call `setBody`

- [ ] **Step 3: Delete `frontmatter` and `rawMarkdown` from `OpenDoc`**

```ts
export type OpenDoc = {
  path: string
  text: string
  dirty: boolean
  savedAt: number | null
  parseError: string | null
  // diskVersion added in Phase 8
}
```

Also delete `blocks: unknown[] | null` (unused).

- [ ] **Step 4: Delete `combineRaw` from `src/lib/yaml.ts`**

If nothing else imports from `yaml.ts`, delete the file.

- [ ] **Step 5: Delete `parseRaw` and `parseSimpleYaml` from `useEditorMode.ts`**

`toggle()` is already a pure view switch (Phase 3). Drop the helpers.

- [ ] **Step 6: Update test fixtures**

`src/features/watcher/__tests__/useExternalChanges.test.ts`, `src/features/ai/__tests__/applyToNote.test.ts`, `src/features/tree/__tests__/moveExecutor.test.ts`, `src/features/editor/__tests__/renameOpenDoc.test.ts` all construct OpenDoc fixtures — migrate each to the new shape.

- [ ] **Step 7: Run full test + typecheck**

```bash
pnpm tsc --noEmit
pnpm test
cargo test --manifest-path src-tauri/Cargo.toml --lib
```
Expected: PASS

- [ ] **Step 8: Manual smoke test**

Full pass:
1. Open a file with frontmatter.
2. Edit a property field. Disk: only frontmatter region changes.
3. Edit body in BlockEditor. Disk: only body changes; frontmatter preserved BYTE-FOR-BYTE.
4. Toggle raw. Visible text = file on disk.
5. Edit in raw. Save. Verify.
6. Touch the file externally (e.g. `echo "# external" >> file.md`). Verify reload.

- [ ] **Step 9: Commit**

```bash
git commit -am "refactor(store): collapse OpenDoc to single text buffer

OpenDoc now carries only \`text\` (the full file contents) plus IO
metadata. The frontmatter object and the separate body string are
gone; all consumers derive what they need from text via parseDoc /
getBody / getFrontmatterValues. combineRaw and parseSimpleYaml in
useEditorMode are deleted as redundant.

This eliminates the two-YAML-parser drift class entirely. Adding new
editor features no longer requires synchronizing two state copies
through a lossy round-trip."
```

---

## Review Gate 1 — request human review

Use `superpowers:requesting-code-review` to review Phases 1–6 together. Wait for sign-off before proceeding.

---

## Phase 7: Rust read/write take String directly

### Task 7: Switch IPC commands to text-only contract

**Files:**
- Modify: `src-tauri/src/commands/fs.rs:144-154` — new signatures
- Modify: `src-tauri/src/commands/frontmatter.rs` — keep `parse_doc` for any remaining Rust callers; delete `serialize_doc`
- Modify: `src/lib/ipc.ts` — match new shapes
- Modify: any TS caller that destructures `{ frontmatter, body }` from `readFile`

- [ ] **Step 1: Update Rust command signatures**

```rust
#[tauri::command]
pub fn read_file(path: PathBuf) -> Result<String> {
    Ok(std::fs::read_to_string(&path)?)
}

#[tauri::command]
pub fn write_file(path: PathBuf, text: String) -> Result<()> {
    write_atomic(&path, &text)
}
```

- [ ] **Step 2: Update `src/lib/ipc.ts`**

```ts
readFile: (path: string) => invoke<string>("read_file", { path }),
writeFile: (path: string, text: string) => invoke<void>("write_file", { path, text }),
```

- [ ] **Step 3: Migrate callers**

- `useOpenFile.ts`: `const text = await ipc.readFile(path); setOpenDoc({ ..., text, parseError: parseDoc(text).parseError })`
- `useAutoSave.ts`: `await ipc.writeFile(path, text)`
- `useExternalChanges.ts`: `const text = await ipc.readFile(doc.path)`
- `renameOpenDoc.ts`: same
- `useFolderPicker.ts` / any other consumer

- [ ] **Step 4: Cargo + ts tests**

```bash
cargo test --manifest-path src-tauri/Cargo.toml --lib
pnpm tsc --noEmit
pnpm test
```
Expected: PASS

- [ ] **Step 5: Manual smoke test**

Same as Phase 6.

- [ ] **Step 6: Commit**

```bash
git commit -am "refactor(ipc): read_file/write_file move plain text bytes

The Rust commands no longer parse and re-serialize frontmatter on every
read and every save. Bytes are written as-is. parse_doc remains as a
shared utility for any internal Rust caller that still needs frontmatter
access (currently: none in the open-doc path).

This removes the last copy of the frontmatter parser from the
write-loop hot path."
```

---

## Phase 8: Centralized write coordinator

### Task 8: Funnel all open-doc writes through `writeOpenDoc`

**Files:**
- Create: `src/lib/writeDoc.ts`
- Modify: `src/features/editor/useAutoSave.ts` — delegate to coordinator
- Modify: `src/features/editor/renameOpenDoc.ts` — delegate
- Modify: `src/features/watcher/useExternalChanges.ts` — `cancelPendingDocSave` becomes `cancelOpenDocWrites`

- [ ] **Step 1: Create `src/lib/writeDoc.ts`**

```ts
// src/lib/writeDoc.ts
import { ipc } from "./ipc"
import { useStore } from "./store"
import { noteSelfWrite } from "../features/watcher/useExternalChanges"
import { debounce } from "./debounce"

const SAVE_DELAY_MS = 500

let pending: ReturnType<typeof debounce> | null = null

/**
 * Persist the open document. Coordinates self-write tracking, pending
 * autosave cancellation, and store updates. The only allowed write
 * path for the open document — anywhere else that writes to it must
 * route through here.
 */
export function scheduleOpenDocSave(path: string, text: string) {
  if (!pending) {
    pending = debounce(async (p: string, t: string) => {
      try {
        noteSelfWrite(p)
        await ipc.writeFile(p, t)
        const cur = useStore.getState().openDoc
        if (cur && cur.path === p) {
          useStore.getState().patchOpenDoc({ dirty: false, savedAt: Date.now() })
        }
      } catch (e) {
        console.error("save failed", e)
      }
    }, SAVE_DELAY_MS)
  }
  pending.call(path, text)
}

export function flushPendingSave() { pending?.flush() }
export function cancelPendingSave() { pending?.cancel() }

/** Synchronous write — used by rename and other explicit flush points. */
export async function writeOpenDocNow(path: string, text: string): Promise<void> {
  cancelPendingSave()
  noteSelfWrite(path)
  await ipc.writeFile(path, text)
}
```

- [ ] **Step 2: Migrate `useAutoSave.ts` to delegate**

The hook becomes a thin React adapter that calls `scheduleOpenDocSave` when `dirty` flips.

- [ ] **Step 3: Migrate `renameOpenDoc.ts` to call `writeOpenDocNow`**

Replace the manual `noteSelfWrite + ipc.writeFile + cancelPendingDocSave` sequence.

- [ ] **Step 4: Update `useExternalChanges.ts`**

Replace `cancelPendingDocSave` import + call with `cancelPendingSave` from the new module. Delete the module-level `activeSaver` plumbing in `useAutoSave.ts`.

- [ ] **Step 5: Tests + smoke**

```bash
pnpm test
pnpm tauri dev  # smoke
```

- [ ] **Step 6: Commit**

```bash
git commit -am "refactor(io): centralize open-doc writes behind a coordinator

Every write to the open document now goes through writeDoc.ts. The
module owns autosave debouncing, self-write tracking, and pending-save
cancellation. Callers no longer have to remember the noteSelfWrite +
cancelPendingDocSave + bumpDocRev sequence — there's a single API."
```

---

## Phase 9: Disk version vector

### Task 9: Hash-based echo detection

**Files:**
- Modify: `src-tauri/src/commands/fs.rs` — `read_file`/`write_file` return `{ text, mtime_ms, hash }` / `{ mtime_ms, hash }`
- Modify: `src/lib/ipc.ts` — match
- Modify: `src/lib/store.ts` — `OpenDoc` gains `diskVersion: { mtime: number; hash: string } | null`
- Modify: `src/features/watcher/useExternalChanges.ts` — compare `reparsed.hash === doc.diskVersion?.hash` for echo detection; drop the 1-second time window for the open-doc reload (keep for tree refresh)
- Modify: `src/lib/writeDoc.ts` — capture the returned `diskVersion` and update store

- [ ] **Step 1: Add hash to Rust commands**

Use `xxhash-rust` crate (lightweight). Compute on the bytes being read/written.

```toml
# src-tauri/Cargo.toml
xxhash-rust = { version = "0.8", features = ["xxh3"] }
```

```rust
use xxhash_rust::xxh3::xxh3_64;

#[derive(Serialize)]
pub struct FileRead { pub text: String, pub mtime_ms: i64, pub hash: String }
#[derive(Serialize)]
pub struct WriteAck { pub mtime_ms: i64, pub hash: String }

#[tauri::command]
pub fn read_file(path: PathBuf) -> Result<FileRead> {
    let bytes = std::fs::read(&path)?;
    let meta = std::fs::metadata(&path)?;
    let mtime_ms = meta.modified()?.duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis() as i64;
    let hash = format!("{:x}", xxh3_64(&bytes));
    let text = String::from_utf8(bytes).map_err(|e| AppError::Io(e.to_string()))?;
    Ok(FileRead { text, mtime_ms, hash })
}

#[tauri::command]
pub fn write_file(path: PathBuf, text: String) -> Result<WriteAck> {
    let bytes = text.as_bytes();
    let hash = format!("{:x}", xxh3_64(bytes));
    write_bytes_atomic_clobber(&path, bytes)?;
    let meta = std::fs::metadata(&path)?;
    let mtime_ms = meta.modified()?.duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis() as i64;
    Ok(WriteAck { mtime_ms, hash })
}
```

- [ ] **Step 2: Plumb through IPC and store**

`OpenDoc.diskVersion` updates on every read and every write ack.

- [ ] **Step 3: Watcher uses hash equality for open-doc reload**

```ts
if (reparsed.hash === doc.diskVersion?.hash) return // echo
```

The recent-self-write Map remains for tree refresh fast-path but is no longer the sole guard for open-doc reload.

- [ ] **Step 4: Tests**

Add Rust tests verifying hash stability and TS tests verifying echo detection by hash.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(io): content-hash echo detection replaces time window

Every read and write returns { text, mtime_ms, hash }. The watcher
compares hashes to decide whether a vault-change event is the editor's
own write echoing back or a genuine external mutation. The previous
1-second RECENT_WRITE_WINDOW_MS heuristic — which silently false-positived
under heavy autosave traffic — is gone for the open-doc path."
```

---

## Review Gate 2 — request final code review

Use `superpowers:requesting-code-review` for Phases 7–9. After approval, the branch is ready to merge.

---

## Self-review checklist (run before executing)

- [ ] Every step references exact files with line numbers where helpful.
- [ ] Every code step contains real code, not a description.
- [ ] No "TBD" or "implement later" placeholders.
- [ ] Type names (`OpenDoc`, `ParsedDoc`, `FileRead`, `WriteAck`) match across tasks.
- [ ] Function names (`parseDoc`, `getBody`, `setBody`, `setFrontmatterField`, `removeFrontmatterField`, `scheduleOpenDocSave`, `writeOpenDocNow`) match across tasks.
- [ ] Each phase ends with a test run and a commit.
- [ ] Review gates are scheduled after Phase 6 and Phase 9.

## Out of scope (intentionally deferred)

- **Position-preserving BlockNote serialization.** Would require either an mdast-positioned parser or a custom serializer that knows source ranges. The idempotent emit guard in Phase 5 handles the common case (no-op render); shape-stable round-trip for *changed* content remains a BlockNote limitation. Re-evaluate after this plan ships.
- **CRDT or operational-transform merge** for concurrent local + external edits. Current behavior (warn on external change to dirty file) is preserved.
- **Settings for YAML formatting style** (key order, quoting). YAML region is rewritten with a canonical format only when actually edited; if the user wants exact preservation, they should edit in raw mode.

## Known regressions (intentional)

- **Complex frontmatter (nested objects, anchors, multi-line strings) loses partial fidelity when round-tripped through Properties.** Today, `combineRaw` serializes nested objects via `JSON.stringify`, producing flow-style YAML like `nested: {"a":1}`. The new lenient `parseSimpleYaml` skips lines it can't model as scalar/array. The disk file remains intact (gray_matter still parses it on read), but the Properties panel won't display fields it can't fully model. Recommended workflow: edit complex frontmatter in raw mode (⌘E). This matches existing best-practice and surfaces the limitation explicitly instead of silently mangling values.
