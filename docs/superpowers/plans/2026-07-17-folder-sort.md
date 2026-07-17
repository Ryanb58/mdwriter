# Per-Folder Sort Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users sort each folder's files by date added or name (asc/desc), persisted per folder, defaulting to newest first (issue #65).

**Architecture:** Rust `list_tree` additionally reports each file's creation time; all ordering happens in the frontend through one pure `sortChildren()` helper applied at every consumer of child order (TreePane, TreeNodeView, visibleRows). Preferences live in the persisted zustand store keyed by folder path.

**Tech Stack:** Tauri 2 (Rust), React 19 + TypeScript, Zustand (persist), vitest + @testing-library/react, phosphor icons.

Spec: `docs/superpowers/specs/2026-07-17-folder-sort-design.md`

## Global Constraints

- Package manager is **pnpm**; frontend tests run with `pnpm test -- <file>`; Rust tests with `cargo test --manifest-path src-tauri/Cargo.toml --lib`.
- Default sort is `{ key: "added", dir: "desc" }` (date added, newest first). Storing the default is forbidden — it must delete the entry.
- Folders always sort before files, A→Z case-insensitive, regardless of preference.
- No new frontend module may call `invoke()` directly — all IPC stays in `src/lib/ipc.ts`.
- Every commit message describes the change; no model names in commits.

---

### Task 1: Rust — report file creation time

**Files:**
- Modify: `src-tauri/src/commands/fs.rs`

**Interfaces:**
- Produces: `TreeNode::File` JSON gains optional `created` (Unix seconds), absent when the filesystem can't report it. Frontend type updated in Task 2.

- [ ] **Step 1: Write the failing test** — append to the `tests` module in `fs.rs` (next to `list_tree_populates_mtime_for_files`, line ~558):

```rust
#[test]
fn list_tree_populates_created_for_files() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("a.md"), b"hi").unwrap();
    let tree = list_tree_inner(&dir.path().canonicalize().unwrap(), None).unwrap();
    let TreeNode::Dir { children, .. } = &tree else { panic!() };
    let TreeNode::File { created, .. } = &children[0] else { panic!() };
    // Birth time is platform/filesystem dependent. Where the OS can report
    // it, the node must carry it; where it can't, None is the contract.
    if std::fs::metadata(dir.path().join("a.md")).unwrap().created().is_ok() {
        let secs = created.expect("created should be present when the fs reports birth time");
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH).unwrap().as_secs() as i64;
        assert!(secs > 0 && secs <= now + 5, "created {secs} out of range");
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib fs::tests::list_tree_populates_created_for_files`
Expected: COMPILE ERROR — `TreeNode::File` has no field `created`.

- [ ] **Step 3: Implement** — three edits in `fs.rs`:

3a. Add the field to the variant (after `mtime`):

```rust
    File {
        name: String,
        path: PathBuf,
        /// Last-modified time as Unix seconds. `None` if the filesystem
        /// can't report it (rare) or the value is before the epoch.
        #[serde(rename = "mtime", skip_serializing_if = "Option::is_none")]
        mtime: Option<i64>,
        /// Creation (birth) time as Unix seconds. `None` where the
        /// filesystem can't report birth time (e.g. some Linux setups).
        #[serde(rename = "created", skip_serializing_if = "Option::is_none")]
        created: Option<i64>,
    },
```

3b. Add the helper below `file_mtime_secs`:

```rust
fn file_created_secs(path: &Path) -> Option<i64> {
    let created = std::fs::metadata(path).ok()?.created().ok()?;
    let dur = created.duration_since(std::time::UNIX_EPOCH).ok()?;
    i64::try_from(dur.as_secs()).ok()
}
```

3c. Populate at both construction sites in `build_tree` (lines ~166-168 and ~188-194):

```rust
    if path.is_file() {
        let mtime = file_mtime_secs(path);
        let created = file_created_secs(path);
        return Ok(TreeNode::File { name, path: path.to_path_buf(), mtime, created });
    }
```

```rust
        } else if is_visible_file(&entry_path, opts) {
            let mtime = file_mtime_secs(&entry_path);
            let created = file_created_secs(&entry_path);
            children.push(TreeNode::File {
                name: entry_name,
                path: entry_path,
                mtime,
                created,
            });
        }
```

- [ ] **Step 4: Run the Rust suite**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib`
Expected: all tests PASS (existing destructuring tests use `..` so they compile unchanged).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/fs.rs
git commit -m "feat(fs): report file creation time in list_tree nodes"
```

---

### Task 2: Sort model — `sortChildren`

**Files:**
- Modify: `src/lib/ipc.ts` (TreeNode file variant)
- Create: `src/features/tree/sortChildren.ts`
- Test: `src/features/tree/__tests__/sortChildren.test.ts`

**Interfaces:**
- Consumes: `TreeNode` from `src/lib/ipc.ts`.
- Produces:
  - `type FolderSortKey = "name" | "added"`, `type FolderSortDir = "asc" | "desc"`, `type FolderSortPref = { key: FolderSortKey; dir: FolderSortDir }`
  - `const DEFAULT_FOLDER_SORT: FolderSortPref` (= `{ key: "added", dir: "desc" }`)
  - `function sameSort(a: FolderSortPref, b: FolderSortPref): boolean`
  - `function sortChildren(children: readonly TreeNode[], pref?: FolderSortPref): TreeNode[]`

- [ ] **Step 1: Update the TS TreeNode type** — in `src/lib/ipc.ts`, extend the file variant and its doc comment (line ~38):

```ts
/**
 * Mirror of Rust `commands::fs::TreeNode`
 * (`#[serde(tag = "kind", rename_all = "lowercase")]`). `path` is a Rust
 * `PathBuf` (serialized as a string). `mtime`/`created` are `Option<i64>`
 * with `skip_serializing_if = "Option::is_none"`, so they are absent (not
 * `null`) when the filesystem can't report them — hence the optional `?`.
 * `created` is the file's birth time; unavailable on some Linux setups.
 */
export type TreeNode =
  | { kind: "dir"; name: string; path: string; children: TreeNode[] }
  | { kind: "file"; name: string; path: string; mtime?: number; created?: number }
```

- [ ] **Step 2: Write the failing tests** — `src/features/tree/__tests__/sortChildren.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import type { TreeNode } from "../../../lib/ipc"
import { sortChildren, DEFAULT_FOLDER_SORT, sameSort } from "../sortChildren"

const file = (name: string, times?: { mtime?: number; created?: number }): TreeNode => ({
  kind: "file",
  name,
  path: `/v/${name}`,
  ...times,
})

const dir = (name: string): TreeNode => ({ kind: "dir", name, path: `/v/${name}`, children: [] })

const names = (nodes: TreeNode[]) => nodes.map((n) => n.name)

describe("sortChildren", () => {
  it("defaults to date added, newest first", () => {
    expect(sameSort(DEFAULT_FOLDER_SORT, { key: "added", dir: "desc" })).toBe(true)
    const out = sortChildren([
      file("old.md", { created: 100 }),
      file("new.md", { created: 300 }),
      file("mid.md", { created: 200 }),
    ])
    expect(names(out)).toEqual(["new.md", "mid.md", "old.md"])
  })

  it("always puts folders first, A→Z, regardless of pref", () => {
    const out = sortChildren(
      [file("a.md", { created: 999 }), dir("zeta"), dir("Alpha")],
      { key: "name", dir: "desc" },
    )
    expect(names(out)).toEqual(["Alpha", "zeta", "a.md"])
  })

  it("sorts by name ascending and descending, case-insensitively", () => {
    const files = [file("banana.md"), file("Apple.md"), file("cherry.md")]
    expect(names(sortChildren(files, { key: "name", dir: "asc" })))
      .toEqual(["Apple.md", "banana.md", "cherry.md"])
    expect(names(sortChildren(files, { key: "name", dir: "desc" })))
      .toEqual(["cherry.md", "banana.md", "Apple.md"])
  })

  it("sorts by date added ascending (oldest first)", () => {
    const out = sortChildren(
      [file("b.md", { created: 200 }), file("a.md", { created: 100 })],
      { key: "added", dir: "asc" },
    )
    expect(names(out)).toEqual(["a.md", "b.md"])
  })

  it("falls back created → mtime → 0", () => {
    const out = sortChildren([
      file("no-times.md"),
      file("mtime-only.md", { mtime: 500 }),
      file("created.md", { created: 400, mtime: 1 }),
    ])
    // desc: mtime-only(500) > created(400) > no-times(0)
    expect(names(out)).toEqual(["mtime-only.md", "created.md", "no-times.md"])
  })

  it("breaks timestamp ties by name ascending", () => {
    const out = sortChildren(
      [file("b.md", { created: 100 }), file("a.md", { created: 100 })],
      { key: "added", dir: "desc" },
    )
    expect(names(out)).toEqual(["a.md", "b.md"])
  })

  it("does not mutate its input", () => {
    const input = [file("b.md"), file("a.md")]
    const copy = [...input]
    sortChildren(input, { key: "name", dir: "asc" })
    expect(input).toEqual(copy)
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm test -- src/features/tree/__tests__/sortChildren.test.ts`
Expected: FAIL — cannot resolve `../sortChildren`.

- [ ] **Step 4: Implement** — `src/features/tree/sortChildren.ts`:

```ts
import type { TreeNode } from "../../lib/ipc"

export type FolderSortKey = "name" | "added"
export type FolderSortDir = "asc" | "desc"

/** How one folder orders its files. Folders themselves always sort first, A→Z. */
export type FolderSortPref = { key: FolderSortKey; dir: FolderSortDir }

/** Issue #65: folders with no stored preference show newest files first. */
export const DEFAULT_FOLDER_SORT: FolderSortPref = { key: "added", dir: "desc" }

export function sameSort(a: FolderSortPref, b: FolderSortPref): boolean {
  return a.key === b.key && a.dir === b.dir
}

type FileNode = Extract<TreeNode, { kind: "file" }>

/** "Date added", best available: birth time, else mtime, else epoch. */
function addedSecs(node: FileNode): number {
  return node.created ?? node.mtime ?? 0
}

// Case-insensitive, with the raw name as a deterministic final tie-break.
function compareNames(a: TreeNode, b: TreeNode): number {
  const folded = a.name.toLowerCase().localeCompare(b.name.toLowerCase())
  return folded !== 0 ? folded : a.name.localeCompare(b.name)
}

/**
 * Order one folder's children for display: dirs first (A→Z, always), then
 * files by the folder's preference (default: date added, newest first).
 * Pure — returns a new array.
 */
export function sortChildren(
  children: readonly TreeNode[],
  pref?: FolderSortPref,
): TreeNode[] {
  const { key, dir } = pref ?? DEFAULT_FOLDER_SORT
  const sign = dir === "asc" ? 1 : -1
  const dirs = children.filter((c) => c.kind === "dir").sort(compareNames)
  const files = (children.filter((c) => c.kind === "file") as FileNode[]).sort((a, b) => {
    if (key === "added") {
      const diff = addedSecs(a) - addedSecs(b)
      if (diff !== 0) return sign * diff
      return compareNames(a, b)
    }
    return sign * compareNames(a, b)
  })
  return [...dirs, ...files]
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test -- src/features/tree/__tests__/sortChildren.test.ts`
Expected: 7 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/ipc.ts src/features/tree/sortChildren.ts src/features/tree/__tests__/sortChildren.test.ts
git commit -m "feat(tree): pure per-folder child sorting with date-added default"
```

---

### Task 3: Store — persisted `folderSortPrefs`

**Files:**
- Modify: `src/lib/store.ts`
- Test: `src/lib/__tests__/folderSortPrefs.test.ts`

**Interfaces:**
- Consumes: `FolderSortPref`, `DEFAULT_FOLDER_SORT`, `sameSort` from `src/features/tree/sortChildren.ts` (type + helpers; no cycle — sortChildren imports only `lib/ipc` types).
- Produces on `AppStore`:
  - `folderSortPrefs: Record<string, FolderSortPref>` (folder absolute path → pref; only non-default entries stored)
  - `setFolderSortPref(path: string, pref: FolderSortPref | null): void` — `null` or a default-equal pref deletes the entry.

- [ ] **Step 1: Write the failing tests** — `src/lib/__tests__/folderSortPrefs.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest"
import { useStore } from "../store"

beforeEach(() => {
  useStore.setState({ folderSortPrefs: {} })
})

describe("setFolderSortPref", () => {
  it("stores a non-default preference", () => {
    useStore.getState().setFolderSortPref("/v/notes", { key: "name", dir: "asc" })
    expect(useStore.getState().folderSortPrefs).toEqual({
      "/v/notes": { key: "name", dir: "asc" },
    })
  })

  it("keeps independent prefs per folder", () => {
    const s = useStore.getState()
    s.setFolderSortPref("/v/a", { key: "name", dir: "asc" })
    s.setFolderSortPref("/v/b", { key: "added", dir: "asc" })
    expect(Object.keys(useStore.getState().folderSortPrefs).sort()).toEqual(["/v/a", "/v/b"])
  })

  it("choosing the default removes the entry instead of storing it", () => {
    useStore.getState().setFolderSortPref("/v/notes", { key: "name", dir: "desc" })
    useStore.getState().setFolderSortPref("/v/notes", { key: "added", dir: "desc" })
    expect(useStore.getState().folderSortPrefs).toEqual({})
  })

  it("null clears the entry", () => {
    useStore.getState().setFolderSortPref("/v/notes", { key: "name", dir: "asc" })
    useStore.getState().setFolderSortPref("/v/notes", null)
    expect(useStore.getState().folderSortPrefs).toEqual({})
  })

  it("no-ops when clearing a folder that has no entry", () => {
    const before = useStore.getState().folderSortPrefs
    useStore.getState().setFolderSortPref("/v/none", null)
    expect(useStore.getState().folderSortPrefs).toBe(before)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- src/lib/__tests__/folderSortPrefs.test.ts`
Expected: FAIL — `setFolderSortPref is not a function`.

- [ ] **Step 3: Implement in `src/lib/store.ts`** — five edits:

3a. Import (top of file):

```ts
import { DEFAULT_FOLDER_SORT, sameSort, type FolderSortPref } from "../features/tree/sortChildren"
```

3b. In the `AppStore` type, after `pinnedPaths: string[]` (line ~122):

```ts
  /**
   * Per-folder file ordering, keyed by the folder's absolute path (the
   * vault root's path keys root-level files). Only deviations from
   * DEFAULT_FOLDER_SORT are stored; persisted across launches. Keys for
   * renamed/deleted folders go stale harmlessly (same tolerance as
   * blockModeOverrides).
   */
  folderSortPrefs: Record<string, FolderSortPref>
```

and after `removePinnedUnder(...)` in the actions block (line ~191):

```ts
  /** `null` (or a pref equal to the default) deletes the folder's entry. */
  setFolderSortPref(path: string, pref: FolderSortPref | null): void
```

3c. Initial state, after `pinnedPaths: [],` (line ~475):

```ts
      folderSortPrefs: {},
```

3d. Action, after the `removePinnedUnder` implementation (line ~556):

```ts
      setFolderSortPref: (path, pref) =>
        set((s) => {
          if (!pref || sameSort(pref, DEFAULT_FOLDER_SORT)) {
            if (!(path in s.folderSortPrefs)) return {}
            const { [path]: _gone, ...rest } = s.folderSortPrefs
            void _gone
            return { folderSortPrefs: rest }
          }
          const cur = s.folderSortPrefs[path]
          if (cur && sameSort(cur, pref)) return {}
          return { folderSortPrefs: { ...s.folderSortPrefs, [path]: pref } }
        }),
```

3e. Persistence — add to `partialize` (after `pinnedPaths: s.pinnedPaths,`):

```ts
        folderSortPrefs: s.folderSortPrefs,
```

and in `merge`, validate the persisted shape (after the `recentFilesByVault` block, line ~943) and include it in the returned object (after `recentFilesByVault,`):

```ts
        // Persisted sort prefs: keep only structurally valid entries so a
        // corrupt or legacy value can never wedge the tree render.
        const folderSortPrefs: Record<string, FolderSortPref> = {}
        if (p.folderSortPrefs && typeof p.folderSortPrefs === "object") {
          for (const [path, pref] of Object.entries(p.folderSortPrefs as Record<string, unknown>)) {
            const cand = pref as FolderSortPref | null
            if (
              cand && typeof cand === "object" &&
              (cand.key === "name" || cand.key === "added") &&
              (cand.dir === "asc" || cand.dir === "desc")
            ) {
              folderSortPrefs[path] = { key: cand.key, dir: cand.dir }
            }
          }
        }
```

```ts
          folderSortPrefs,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- src/lib/__tests__/folderSortPrefs.test.ts`
Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/store.ts src/lib/__tests__/folderSortPrefs.test.ts
git commit -m "feat(store): persist per-folder sort preferences"
```

---

### Task 4: `visibleRows` honors sort prefs

**Files:**
- Modify: `src/features/tree/visibleRows.ts`, `src/features/tree/selection.ts`
- Test: `src/features/tree/__tests__/visibleRows.test.ts` (extend)

**Interfaces:**
- Consumes: `sortChildren`, `FolderSortPref` (Task 2).
- Produces: `visibleRows(tree, expanded, prefs?: Record<string, FolderSortPref>)` — third param optional, defaults to `{}` (= default sort everywhere).

- [ ] **Step 1: Write the failing test** — append to `visibleRows.test.ts` (the existing `file` helper gains an optional `created`):

```ts
// Update the helper at the top of the file:
const file = (path: string, created?: number): TreeNode => ({
  kind: "file",
  name: path.split("/").pop()!,
  path,
  ...(created !== undefined ? { created } : {}),
})
```

```ts
describe("visibleRows sorting", () => {
  it("orders each folder's files by its own pref, default newest-first", () => {
    const tree = dir("/root", [
      dir("/root/notes", [file("/root/notes/old.md", 100), file("/root/notes/new.md", 200)]),
      file("/root/a.md", 100),
      file("/root/b.md", 200),
    ])
    const expanded = new Set(["/root/notes"])
    // notes pinned to name A→Z; root left on the newest-first default.
    const prefs = { "/root/notes": { key: "name", dir: "asc" } as const }
    const rows = visibleRows(tree, expanded, prefs)
    // notes is name-A→Z (`new.md` < `old.md`); the root default is newest
    // first, so b.md (200) precedes a.md (100).
    expect(rows.map((r) => r.path)).toEqual([
      "/root/notes",
      "/root/notes/new.md",
      "/root/notes/old.md",
      "/root/b.md",
      "/root/a.md",
    ])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/features/tree/__tests__/visibleRows.test.ts`
Expected: the new test FAILS (raw order preserved today); existing tests still pass.

- [ ] **Step 3: Implement** — `visibleRows.ts`:

```ts
import type { TreeNode } from "../../lib/ipc"
import { sortChildren, type FolderSortPref } from "./sortChildren"

/**
 * Flatten the tree into an in-order list of *visible* rows, given which
 * folders are expanded and each folder's sort preference. The root node
 * itself is not produced — only its descendants — matching what TreePane
 * renders. Ordering MUST match the rendered tree (TreePane/TreeNodeView),
 * so all three go through sortChildren.
 *
 * Used for shift-click range selection, where we need to enumerate rows
 * in the order the user sees them.
 */
export function visibleRows(
  tree: TreeNode | null,
  expanded: Set<string>,
  prefs: Record<string, FolderSortPref> = {},
): TreeNode[] {
  if (!tree || tree.kind !== "dir") return []
  const out: TreeNode[] = []
  const walk = (node: TreeNode) => {
    if (node.kind === "dir") {
      out.push(node)
      if (expanded.has(node.path)) {
        for (const child of sortChildren(node.children, prefs[node.path])) walk(child)
      }
    } else {
      out.push(node)
    }
  }
  for (const child of sortChildren(tree.children, prefs[tree.path])) walk(child)
  return out
}
```

(`rangeBetween` is unchanged.)

Update both call sites in `selection.ts` (lines 22 and 41):

```ts
    const rows = visibleRows(s.tree, s.expandedFolders, s.folderSortPrefs)
```

- [ ] **Step 4: Run the tree tests**

Run: `pnpm test -- src/features/tree`
Expected: all PASS (existing visibleRows fixtures have no timestamps → ties broken by name asc, matching their current expectations).

- [ ] **Step 5: Commit**

```bash
git add src/features/tree/visibleRows.ts src/features/tree/selection.ts src/features/tree/__tests__/visibleRows.test.ts
git commit -m "feat(tree): visible-row order follows per-folder sort prefs"
```

---

### Task 5: UI — sort menu + folder row / pane header controls

**Files:**
- Create: `src/features/tree/FolderSortMenu.tsx`
- Modify: `src/features/tree/TreeNode.tsx`, `src/features/tree/TreePane.tsx`
- Test: `src/features/tree/__tests__/FolderSortMenu.test.tsx`

**Interfaces:**
- Consumes: `TreeContextMenu` (auto-closes after any item click), store `folderSortPrefs`/`setFolderSortPref` (Task 3), `sortChildren`/`sameSort`/`DEFAULT_FOLDER_SORT` (Task 2).
- Produces: `<FolderSortMenu x y folderPath onClose />`; folder rows and the pane header render an `ArrowsDownUp` trigger button.

- [ ] **Step 1: Write the failing component test** — `src/features/tree/__tests__/FolderSortMenu.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { useStore } from "../../../lib/store"
import { FolderSortMenu } from "../FolderSortMenu"

beforeEach(() => {
  useStore.setState({ folderSortPrefs: {} })
})

describe("FolderSortMenu", () => {
  it("lists all four sort options", () => {
    render(<FolderSortMenu x={0} y={0} folderPath="/v/notes" onClose={() => {}} />)
    for (const label of [
      "Name (A → Z)",
      "Name (Z → A)",
      "Date added (newest first)",
      "Date added (oldest first)",
    ]) {
      expect(screen.getByRole("menuitem", { name: new RegExp(label.replace(/[()]/g, "\\$&")) })).toBeTruthy()
    }
  })

  it("stores the picked pref and closes", () => {
    const onClose = vi.fn()
    render(<FolderSortMenu x={0} y={0} folderPath="/v/notes" onClose={onClose} />)
    fireEvent.click(screen.getByRole("menuitem", { name: /Name \(Z → A\)/ }))
    expect(useStore.getState().folderSortPrefs["/v/notes"]).toEqual({ key: "name", dir: "desc" })
    expect(onClose).toHaveBeenCalled()
  })

  it("picking the default clears the stored entry", () => {
    useStore.getState().setFolderSortPref("/v/notes", { key: "name", dir: "asc" })
    render(<FolderSortMenu x={0} y={0} folderPath="/v/notes" onClose={() => {}} />)
    fireEvent.click(screen.getByRole("menuitem", { name: /Date added \(newest first\)/ }))
    expect(useStore.getState().folderSortPrefs["/v/notes"]).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/features/tree/__tests__/FolderSortMenu.test.tsx`
Expected: FAIL — cannot resolve `../FolderSortMenu`.

- [ ] **Step 3: Implement `FolderSortMenu.tsx`**

```tsx
import { Check } from "@phosphor-icons/react"
import { TreeContextMenu, type ContextActionGroup } from "./TreeContextMenu"
import { useStore } from "../../lib/store"
import { DEFAULT_FOLDER_SORT, sameSort, type FolderSortPref } from "./sortChildren"

const SORT_OPTIONS: { label: string; pref: FolderSortPref }[] = [
  { label: "Name (A → Z)", pref: { key: "name", dir: "asc" } },
  { label: "Name (Z → A)", pref: { key: "name", dir: "desc" } },
  { label: "Date added (newest first)", pref: { key: "added", dir: "desc" } },
  { label: "Date added (oldest first)", pref: { key: "added", dir: "asc" } },
]

/**
 * Anchored picker for one folder's file ordering. Backed by
 * `folderSortPrefs` — choosing the app default clears the entry rather
 * than storing it (setFolderSortPref owns that rule).
 */
export function FolderSortMenu({
  x, y, folderPath, onClose,
}: {
  x: number
  y: number
  folderPath: string
  onClose: () => void
}) {
  const prefs = useStore((s) => s.folderSortPrefs)
  const setFolderSortPref = useStore((s) => s.setFolderSortPref)
  const active = prefs[folderPath] ?? DEFAULT_FOLDER_SORT
  const groups: ContextActionGroup[] = [
    SORT_OPTIONS.map(({ label, pref }) => ({
      label,
      icon: sameSort(active, pref) ? <Check size={14} /> : undefined,
      onClick: () => setFolderSortPref(folderPath, pref),
    })),
  ]
  return <TreeContextMenu x={x} y={y} groups={groups} onClose={onClose} />
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/features/tree/__tests__/FolderSortMenu.test.tsx`
Expected: 3 tests PASS.

- [ ] **Step 5: Wire the folder-row control in `TreeNode.tsx`**

5a. Imports: add `ArrowsDownUp` to the phosphor import list; add:

```ts
import { FolderSortMenu } from "./FolderSortMenu"
```

5b. State + store reads (next to the existing `menu` state, line ~16):

```tsx
  const [sortMenu, setSortMenu] = useState<{ x: number; y: number } | null>(null)
  const folderSortPrefs = useStore((s) => s.folderSortPrefs)
  const hasCustomSort = isDir && folderSortPrefs[node.path] !== undefined
```

(`hasCustomSort` must be declared after `isDir`, line ~28.)

5c. Button — insert immediately before the `{canPin && !renaming && (` block (line ~197); dirs never satisfy `canPin`, so exactly one right-aligned button renders per row:

```tsx
        {isDir && !renaming && (
          <button
            type="button"
            className={[
              "ml-auto flex-none rounded p-0.5 transition-colors",
              hasCustomSort
                ? "text-text-subtle opacity-100 hover:bg-elevated hover:text-text"
                : "text-text-subtle opacity-0 hover:bg-elevated hover:text-text group-hover:opacity-100",
            ].join(" ")}
            title="Sort folder"
            aria-label={`Sort ${displayName}`}
            onClick={(e) => {
              e.stopPropagation()
              const r = e.currentTarget.getBoundingClientRect()
              setSortMenu({ x: r.left, y: r.bottom + 4 })
            }}
          >
            <ArrowsDownUp size={12} />
          </button>
        )}
```

5d. Children render through the sorter (line ~217):

```tsx
      {isDir && expanded && sortChildren(
        (node as Extract<TN, { kind: "dir" }>).children,
        folderSortPrefs[node.path],
      ).map((c) => (
        <TreeNodeView key={c.path} node={c} depth={depth + 1} />
      ))}
```

with import:

```ts
import { sortChildren } from "./sortChildren"
```

5e. Menu render, next to the existing context-menu line (line ~220):

```tsx
      {sortMenu && (
        <FolderSortMenu
          x={sortMenu.x}
          y={sortMenu.y}
          folderPath={node.path}
          onClose={() => setSortMenu(null)}
        />
      )}
```

- [ ] **Step 6: Wire the root control in `TreePane.tsx`**

6a. Imports:

```ts
import { useState } from "react"
import { FilePlus, FolderPlus, ArrowsDownUp } from "@phosphor-icons/react"
import { FolderSortMenu } from "./FolderSortMenu"
import { sortChildren } from "./sortChildren"
```

6b. Inside the component (top, after the store reads):

```tsx
  const folderSortPrefs = useStore((s) => s.folderSortPrefs)
  const [sortMenu, setSortMenu] = useState<{ x: number; y: number } | null>(null)
```

6c. Header button, after the New-folder button (line ~38) — root files are keyed by `tree.path` (the canonical root), matching `visibleRows`:

```tsx
        <button
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            setSortMenu({ x: r.left, y: r.bottom + 4 })
          }}
          className="p-1 rounded text-text-subtle hover:text-text hover:bg-elevated transition-colors"
          title="Sort root files"
        >
          <ArrowsDownUp size={13} />
        </button>
```

6d. Root children render through the sorter (line ~53):

```tsx
        {tree.kind === "dir" && sortChildren(tree.children, folderSortPrefs[tree.path]).map((c) => (
          <TreeNodeView key={c.path} node={c} />
        ))}
```

6e. Menu render, before the closing `</div>` of the outer flex column:

```tsx
      {sortMenu && (
        <FolderSortMenu
          x={sortMenu.x}
          y={sortMenu.y}
          folderPath={tree.path}
          onClose={() => setSortMenu(null)}
        />
      )}
```

- [ ] **Step 7: Full frontend suite + typecheck**

Run: `pnpm test` then `pnpm build`
Expected: all tests PASS; `tsc` clean.

- [ ] **Step 8: Commit**

```bash
git add src/features/tree/FolderSortMenu.tsx src/features/tree/TreeNode.tsx src/features/tree/TreePane.tsx src/features/tree/__tests__/FolderSortMenu.test.tsx
git commit -m "feat(tree): per-folder sort control on folder rows and pane header (#65)"
```

---

### Task 6: Final verification

- [ ] **Step 1: Full frontend suite** — `pnpm test` → all PASS.
- [ ] **Step 2: Rust suite** — `cargo test --manifest-path src-tauri/Cargo.toml --lib` → all PASS.
- [ ] **Step 3: Typecheck/build** — `pnpm build` → clean.
- [ ] **Step 4: Review the diff** (`git diff main --stat`) against the spec's Out-of-scope list — no folder re-ordering by pref, no recursive apply, no manual ordering.
