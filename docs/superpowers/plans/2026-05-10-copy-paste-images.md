# Copy-Paste Images Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users paste a clipboard bitmap or drag an image file into the editor and have it saved as a file in the vault with a relative `![](path)` reference inserted at the cursor, in both block and raw modes, with configurable on-disk location and filename template.

**Architecture:** Three layers wired through one shared helper. A single Rust command (`write_image`) writes binary bytes atomically. A pure-TS module (`src/lib/imagePaste.ts`) picks the directory, generates a filename from a token template, calls the Rust command, and computes the relative path for embedding. BlockNote's built-in `uploadFile` + `resolveFileUrl` hooks consume the helper for block mode; a small `useRawImagePaste` hook does the same for the CodeMirror host in raw mode. Two new settings (`imagesLocation`, `imageFilenameTemplate`) plumb through the existing Zustand store and a new "Images" section in `SettingsPanel`.

**Tech Stack:** Tauri 2 (Rust), React 19, TypeScript 5, BlockNote 0.50, CodeMirror 6, Zustand 5, Vitest, `@tauri-apps/api/core` (`invoke`, `convertFileSrc`).

**Spec:** `docs/superpowers/specs/2026-05-10-copy-paste-images-design.md`

---

## File Map

| File | Status | Responsibility |
|---|---|---|
| `src-tauri/src/commands/fs.rs` | Modify | Add `write_image` command + atomic bytes write helper |
| `src-tauri/src/lib.rs` | Modify | Register `write_image` in `invoke_handler!` |
| `src-tauri/tauri.conf.json` | Modify | Enable `assetProtocol` with scope `**` |
| `src-tauri/capabilities/default.json` | Modify | Allow `asset:` permission for main window |
| `src/lib/ipc.ts` | Modify | Add `writeImage(path, bytes)` wrapper |
| `src/lib/store.ts` | Modify | Add `imagesLocation`, `imageFilenameTemplate` to `Settings` + defaults + persist |
| `src/lib/imagePaste.ts` | Create | `mimeToExt`, `resolveImageDir`, `generateFilename`, `relativeFromDocDir`, `saveImage` |
| `src/lib/__tests__/imagePaste.test.ts` | Create | Unit tests for all of the above |
| `src/features/editor/BlockEditor.tsx` | Modify | Pass `uploadFile` and `resolveFileUrl` into `useCreateBlockNote` |
| `src/features/editor/useRawImagePaste.ts` | Create | Hook that attaches paste/drop handlers to a CodeMirror `EditorView` |
| `src/features/editor/RawEditor.tsx` | Modify | Wire `useRawImagePaste` |
| `src/features/settings/SettingsPanel.tsx` | Modify | Add "Images" section with storage-location segmented control and filename-template input |

---

## Task 1: Rust `write_image` command

**Files:**
- Modify: `src-tauri/src/commands/fs.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add the failing test**

Append to the `write_tests` module at the bottom of `src-tauri/src/commands/fs.rs`:

```rust
    #[test]
    fn write_image_writes_bytes() {
        let dir = tempdir().unwrap();
        let p = dir.path().join("assets").join("foo.png");
        let bytes = vec![0x89, b'P', b'N', b'G', 0, 1, 2, 3];
        write_image(p.clone(), bytes.clone()).unwrap();
        assert_eq!(std::fs::read(&p).unwrap(), bytes);
    }

    #[test]
    fn write_image_creates_missing_parent_dirs() {
        let dir = tempdir().unwrap();
        let p = dir.path().join("a").join("b").join("c").join("x.png");
        write_image(p.clone(), vec![1, 2, 3]).unwrap();
        assert!(p.exists());
    }

    #[test]
    fn write_image_errors_when_destination_exists() {
        let dir = tempdir().unwrap();
        let p = dir.path().join("x.png");
        std::fs::write(&p, b"old").unwrap();
        let err = write_image(p, vec![1, 2, 3]).unwrap_err();
        assert!(matches!(err, AppError::Io(_)));
    }

    #[test]
    fn write_image_atomic_cleans_up_temp_on_success() {
        let dir = tempdir().unwrap();
        let p = dir.path().join("x.png");
        write_image(p.clone(), vec![1, 2, 3]).unwrap();
        let tmp = dir.path().join(".x.png.tmp");
        assert!(!tmp.exists());
        assert!(p.exists());
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib write_image`
Expected: FAIL with "cannot find function `write_image` in this scope" (compile error).

- [ ] **Step 3: Add the command and helper**

Add this near the existing `write_atomic` helper in `src-tauri/src/commands/fs.rs`:

```rust
#[tauri::command]
pub fn write_image(path: PathBuf, bytes: Vec<u8>) -> Result<()> {
    if path.exists() {
        return Err(AppError::Io(format!("already exists: {}", path.display())));
    }
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            std::fs::create_dir_all(parent)?;
        }
    }
    write_bytes_atomic(&path, &bytes)
}

fn write_bytes_atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| AppError::InvalidPath(path.display().to_string()))?;
    let temp = parent.join(format!(".{}.tmp", path.file_name().unwrap().to_string_lossy()));
    {
        let mut f = std::fs::File::create(&temp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
    }
    std::fs::rename(&temp, path)?;
    Ok(())
}
```

- [ ] **Step 4: Register the command**

In `src-tauri/src/lib.rs`, add `commands::fs::write_image,` to the `invoke_handler` macro, immediately after `commands::fs::trash_path,`:

```rust
        .invoke_handler(tauri::generate_handler![
            commands::fs::list_tree,
            commands::fs::read_file,
            commands::fs::write_file,
            commands::fs::create_file,
            commands::fs::create_dir,
            commands::fs::rename_path,
            commands::fs::trash_path,
            commands::fs::write_image,
            commands::recent::get_recent_folders,
            // …rest unchanged
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib write_image`
Expected: 4 tests pass.

Also run the full Rust suite to confirm nothing else broke:
Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/commands/fs.rs src-tauri/src/lib.rs
git commit -m "Add write_image Tauri command for atomic binary writes"
```

---

## Task 2: Frontend IPC wrapper

**Files:**
- Modify: `src/lib/ipc.ts`

- [ ] **Step 1: Add the IPC wrapper**

Append to the `ipc` object in `src/lib/ipc.ts`, after the `trashPath` line:

```ts
  writeImage: (path: string, bytes: Uint8Array) =>
    invoke<void>("write_image", { path, bytes: Array.from(bytes) }),
```

The `Array.from(bytes)` is required because Tauri's IPC layer can't serialize a `Uint8Array` directly; it expects a JSON array of numbers which Tauri deserializes into `Vec<u8>` on the Rust side.

- [ ] **Step 2: Verify TypeScript compiles**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/ipc.ts
git commit -m "Add writeImage IPC wrapper"
```

---

## Task 3: Settings — types and defaults

**Files:**
- Modify: `src/lib/store.ts`

- [ ] **Step 1: Extend the `Settings` type**

In `src/lib/store.ts`, find the `Settings` type and add two fields:

```ts
export type ImagesLocation = "vault-assets" | "sibling-assets" | "same-folder"

export type Settings = {
  theme: Theme
  autoRenameFromH1: boolean
  hideGitignored: boolean
  showPdfs: boolean
  showImages: boolean
  showUnsupported: boolean
  imagesLocation: ImagesLocation
  imageFilenameTemplate: string
}
```

- [ ] **Step 2: Update `DEFAULT_SETTINGS`**

Add the two defaults to `DEFAULT_SETTINGS` in the same file:

```ts
export const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  autoRenameFromH1: true,
  hideGitignored: false,
  showPdfs: false,
  showImages: false,
  showUnsupported: false,
  imagesLocation: "vault-assets",
  imageFilenameTemplate: "{date}-{time}-{rand}",
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `pnpm exec tsc --noEmit`
Expected: no errors. (Old persisted localStorage state will simply lack the new keys; Zustand's `persist` middleware merges defaults on rehydrate.)

- [ ] **Step 4: Commit**

```bash
git add src/lib/store.ts
git commit -m "Add imagesLocation and imageFilenameTemplate settings"
```

---

## Task 4: `imagePaste.ts` — pure helper functions (TDD)

**Files:**
- Create: `src/lib/imagePaste.ts`
- Create: `src/lib/__tests__/imagePaste.test.ts`

Each step below adds one function and the tests that exercise it. Do them in order — later functions depend on earlier ones.

### Step 1: `mimeToExt`

- [ ] **Step 1.1: Write failing tests**

Create `src/lib/__tests__/imagePaste.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mimeToExt,
  resolveImageDir,
  generateFilename,
  relativeFromDocDir,
  saveImage,
} from "../imagePaste"

describe("mimeToExt", () => {
  it("maps supported image MIME types", () => {
    expect(mimeToExt("image/png")).toBe("png")
    expect(mimeToExt("image/jpeg")).toBe("jpg")
    expect(mimeToExt("image/gif")).toBe("gif")
    expect(mimeToExt("image/webp")).toBe("webp")
    expect(mimeToExt("image/svg+xml")).toBe("svg")
    expect(mimeToExt("image/avif")).toBe("avif")
    expect(mimeToExt("image/bmp")).toBe("bmp")
  })

  it("returns null for unsupported MIME", () => {
    expect(mimeToExt("image/heic")).toBeNull()
    expect(mimeToExt("application/octet-stream")).toBeNull()
    expect(mimeToExt("")).toBeNull()
  })

  it("is case-insensitive", () => {
    expect(mimeToExt("IMAGE/PNG")).toBe("png")
  })
})
```

- [ ] **Step 1.2: Run, expect failure**

Run: `pnpm test src/lib/__tests__/imagePaste.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 1.3: Implement**

Create `src/lib/imagePaste.ts`:

```ts
import { ipc } from "./ipc"
import type { ImagesLocation } from "./store"

const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/avif": "avif",
  "image/bmp": "bmp",
}

export function mimeToExt(mime: string): string | null {
  return MIME_TO_EXT[mime.toLowerCase()] ?? null
}
```

- [ ] **Step 1.4: Run, expect pass**

Run: `pnpm test src/lib/__tests__/imagePaste.test.ts -t mimeToExt`
Expected: 3 tests pass.

### Step 2: `resolveImageDir`

- [ ] **Step 2.1: Add failing tests**

Append to `src/lib/__tests__/imagePaste.test.ts`:

```ts
describe("resolveImageDir", () => {
  it("vault-assets returns <vault>/assets regardless of note depth", () => {
    expect(resolveImageDir("/Vault", "/Vault/note.md", "vault-assets"))
      .toBe("/Vault/assets")
    expect(resolveImageDir("/Vault", "/Vault/sub/deep/note.md", "vault-assets"))
      .toBe("/Vault/assets")
  })

  it("sibling-assets returns <note-dir>/<stem>.assets", () => {
    expect(resolveImageDir("/Vault", "/Vault/note.md", "sibling-assets"))
      .toBe("/Vault/note.assets")
    expect(resolveImageDir("/Vault", "/Vault/sub/post.md", "sibling-assets"))
      .toBe("/Vault/sub/post.assets")
  })

  it("same-folder returns the note's directory", () => {
    expect(resolveImageDir("/Vault", "/Vault/note.md", "same-folder"))
      .toBe("/Vault")
    expect(resolveImageDir("/Vault", "/Vault/sub/post.md", "same-folder"))
      .toBe("/Vault/sub")
  })

  it("works with Windows-style separators", () => {
    expect(resolveImageDir("C:\\Vault", "C:\\Vault\\sub\\note.md", "vault-assets"))
      .toBe("C:\\Vault\\assets")
    expect(resolveImageDir("C:\\Vault", "C:\\Vault\\sub\\note.md", "same-folder"))
      .toBe("C:\\Vault\\sub")
  })
})
```

- [ ] **Step 2.2: Run, expect failure**

Run: `pnpm test src/lib/__tests__/imagePaste.test.ts -t resolveImageDir`
Expected: FAIL — `resolveImageDir is not a function`.

- [ ] **Step 2.3: Implement**

Append to `src/lib/imagePaste.ts`:

```ts
function detectSep(p: string): "/" | "\\" {
  return p.includes("\\") && !p.includes("/") ? "\\" : "/"
}

function parentDir(p: string): string {
  const idx = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"))
  return idx <= 0 ? "" : p.slice(0, idx)
}

function joinPath(a: string, b: string): string {
  const sep = detectSep(a)
  return a.endsWith(sep) ? a + b : a + sep + b
}

function fileStem(p: string): string {
  const name = p.split(/[\\/]/).pop() ?? ""
  const dot = name.lastIndexOf(".")
  return dot <= 0 ? name : name.slice(0, dot)
}

export function resolveImageDir(
  vaultRoot: string,
  docPath: string,
  location: ImagesLocation,
): string {
  switch (location) {
    case "vault-assets":
      return joinPath(vaultRoot, "assets")
    case "sibling-assets":
      return joinPath(parentDir(docPath), `${fileStem(docPath)}.assets`)
    case "same-folder":
      return parentDir(docPath)
  }
}
```

- [ ] **Step 2.4: Run, expect pass**

Run: `pnpm test src/lib/__tests__/imagePaste.test.ts -t resolveImageDir`
Expected: 4 tests pass.

### Step 3: `generateFilename`

- [ ] **Step 3.1: Add failing tests**

Append to `src/lib/__tests__/imagePaste.test.ts`:

```ts
describe("generateFilename", () => {
  const now = new Date("2026-05-10T14:30:52")  // local time
  const rand = () => "a3f1"

  it("default template produces YYYY-MM-DD-HHMMSS-<hex>.<ext>", () => {
    const name = generateFilename("image/png", "{date}-{time}-{rand}", {
      docPath: "/Vault/note.md", now, rand,
    })
    expect(name).toBe("2026-05-10-143052-a3f1.png")
  })

  it("supports {note} token with slugified note stem", () => {
    const name = generateFilename("image/png", "{note}-{rand}", {
      docPath: "/Vault/My Post! Title.md", now, rand,
    })
    expect(name).toBe("my-post-title-a3f1.png")
  })

  it("leaves unknown tokens literal", () => {
    const name = generateFilename("image/png", "{date}-{xyz}-{rand}", {
      docPath: "/Vault/note.md", now, rand,
    })
    expect(name).toBe("2026-05-10-{xyz}-a3f1.png")
  })

  it("strips illegal filename characters", () => {
    const name = generateFilename("image/png", "a<b>c:d/e\\f|g.h", {
      docPath: "/Vault/note.md", now, rand,
    })
    expect(name).toBe("abcdefg.h.png")
  })

  it("falls back to default template when sanitized template is empty", () => {
    const name = generateFilename("image/png", "///", {
      docPath: "/Vault/note.md", now, rand,
    })
    expect(name).toBe("2026-05-10-143052-a3f1.png")
  })

  it("throws when MIME is unsupported", () => {
    expect(() =>
      generateFilename("image/heic", "{date}", { docPath: "/x.md", now, rand }),
    ).toThrow(/unsupported/i)
  })

  it("uses jpg for image/jpeg", () => {
    const name = generateFilename("image/jpeg", "{rand}", {
      docPath: "/note.md", now, rand,
    })
    expect(name).toBe("a3f1.jpg")
  })
})
```

- [ ] **Step 3.2: Run, expect failure**

Run: `pnpm test src/lib/__tests__/imagePaste.test.ts -t generateFilename`
Expected: FAIL — `generateFilename is not a function`.

- [ ] **Step 3.3: Implement**

Append to `src/lib/imagePaste.ts`:

```ts
const DEFAULT_TEMPLATE = "{date}-{time}-{rand}"
// Characters illegal in filenames on at least one major OS.
// (Path separators and the Windows reserved set; plus control chars.)
// eslint-disable-next-line no-control-regex
const ILLEGAL_CHARS = /[<>:"/\\|?*\x00-\x1f]/g

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`
}

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function formatTime(d: Date): string {
  return `${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`
}

function randHex(): string {
  // 4 hex chars = 16 bits of entropy. Plenty for collision avoidance
  // when combined with a timestamp.
  const bytes = new Uint8Array(2)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

function sanitizeForFilename(s: string): string {
  return s.replace(ILLEGAL_CHARS, "")
}

export function generateFilename(
  mime: string,
  template: string,
  ctx: { docPath: string; now?: Date; rand?: () => string },
): string {
  const ext = mimeToExt(mime)
  if (!ext) throw new Error(`unsupported image MIME: ${mime}`)

  const now = ctx.now ?? new Date()
  const rand = ctx.rand ?? randHex

  function expand(tmpl: string): string {
    return tmpl.replace(/\{(date|time|rand|note)\}/g, (_, tok) => {
      if (tok === "date") return formatDate(now)
      if (tok === "time") return formatTime(now)
      if (tok === "rand") return rand()
      if (tok === "note") return slugify(fileStem(ctx.docPath))
      return _
    })
  }

  let stem = sanitizeForFilename(expand(template))
  if (!stem) stem = sanitizeForFilename(expand(DEFAULT_TEMPLATE))
  return `${stem}.${ext}`
}
```

- [ ] **Step 3.4: Run, expect pass**

Run: `pnpm test src/lib/__tests__/imagePaste.test.ts -t generateFilename`
Expected: 7 tests pass.

### Step 4: `relativeFromDocDir`

- [ ] **Step 4.1: Add failing tests**

Append to `src/lib/__tests__/imagePaste.test.ts`:

```ts
describe("relativeFromDocDir", () => {
  it("note at vault root, image in assets/", () => {
    expect(relativeFromDocDir("/Vault/note.md", "/Vault/assets/x.png"))
      .toBe("assets/x.png")
  })

  it("note in nested folder, image at vault assets/", () => {
    expect(relativeFromDocDir("/Vault/notes/sub/note.md", "/Vault/assets/x.png"))
      .toBe("../../assets/x.png")
  })

  it("note and image in same folder", () => {
    expect(relativeFromDocDir("/Vault/note.md", "/Vault/x.png"))
      .toBe("x.png")
  })

  it("sibling .assets folder", () => {
    expect(relativeFromDocDir("/Vault/notes/post.md", "/Vault/notes/post.assets/x.png"))
      .toBe("post.assets/x.png")
  })

  it("emits POSIX separators even on Windows paths", () => {
    expect(relativeFromDocDir("C:\\Vault\\note.md", "C:\\Vault\\assets\\x.png"))
      .toBe("assets/x.png")
  })
})
```

- [ ] **Step 4.2: Run, expect failure**

Run: `pnpm test src/lib/__tests__/imagePaste.test.ts -t relativeFromDocDir`
Expected: FAIL.

- [ ] **Step 4.3: Implement**

Append to `src/lib/imagePaste.ts`:

```ts
function splitSegments(p: string): string[] {
  return p.split(/[\\/]/).filter(Boolean)
}

export function relativeFromDocDir(docPath: string, absolutePath: string): string {
  const fromSegs = splitSegments(parentDir(docPath))
  const toSegs = splitSegments(absolutePath)
  let i = 0
  while (i < fromSegs.length && i < toSegs.length && fromSegs[i] === toSegs[i]) i++
  const up = Array(fromSegs.length - i).fill("..")
  return [...up, ...toSegs.slice(i)].join("/")
}
```

- [ ] **Step 4.4: Run, expect pass**

Run: `pnpm test src/lib/__tests__/imagePaste.test.ts -t relativeFromDocDir`
Expected: 5 tests pass.

### Step 5: `saveImage` (with mocked invoke)

- [ ] **Step 5.1: Add failing tests**

Append to `src/lib/__tests__/imagePaste.test.ts`:

```ts
// Mock the invoke call used by ipc.writeImage. We do this at the module
// boundary so saveImage's wiring is exercised end-to-end.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}))

import { invoke } from "@tauri-apps/api/core"

describe("saveImage", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset()
  })

  it("writes bytes and returns absolute + relative paths", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined)
    const bytes = new Uint8Array([1, 2, 3])
    const result = await saveImage({
      bytes,
      mime: "image/png",
      vaultRoot: "/Vault",
      docPath: "/Vault/note.md",
      location: "vault-assets",
      template: "{rand}",
      now: new Date("2026-05-10T14:30:52"),
      rand: () => "a3f1",
    })
    expect(result.relativePath).toBe("assets/a3f1.png")
    expect(result.absolutePath).toBe("/Vault/assets/a3f1.png")
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke).toHaveBeenCalledWith("write_image", {
      path: "/Vault/assets/a3f1.png",
      bytes: [1, 2, 3],
    })
  })

  it("retries with a new name on collision", async () => {
    // First call: already-exists error; second: success.
    let n = 0
    vi.mocked(invoke).mockImplementation(async () => {
      if (n++ === 0) throw { kind: "Io", message: "already exists: /Vault/assets/a.png" }
    })
    const rand = vi.fn().mockReturnValueOnce("aaaa").mockReturnValueOnce("bbbb")
    const result = await saveImage({
      bytes: new Uint8Array([0]),
      mime: "image/png",
      vaultRoot: "/Vault",
      docPath: "/Vault/note.md",
      location: "vault-assets",
      template: "{rand}",
      now: new Date("2026-05-10T14:30:52"),
      rand,
    })
    expect(result.relativePath).toBe("assets/bbbb.png")
    expect(invoke).toHaveBeenCalledTimes(2)
  })

  it("throws on unsupported MIME without calling invoke", async () => {
    await expect(
      saveImage({
        bytes: new Uint8Array([0]),
        mime: "image/heic",
        vaultRoot: "/Vault",
        docPath: "/Vault/note.md",
        location: "vault-assets",
        template: "{rand}",
      }),
    ).rejects.toThrow(/unsupported/i)
    expect(invoke).not.toHaveBeenCalled()
  })

  it("gives up after 4 collisions", async () => {
    vi.mocked(invoke).mockRejectedValue({ kind: "Io", message: "already exists: x" })
    await expect(
      saveImage({
        bytes: new Uint8Array([0]),
        mime: "image/png",
        vaultRoot: "/Vault",
        docPath: "/Vault/note.md",
        location: "vault-assets",
        template: "{rand}",
        now: new Date("2026-05-10T14:30:52"),
        rand: () => "a3f1",
      }),
    ).rejects.toThrow(/unique filename/i)
    expect(invoke).toHaveBeenCalledTimes(4)
  })
})
```

- [ ] **Step 5.2: Run, expect failure**

Run: `pnpm test src/lib/__tests__/imagePaste.test.ts -t saveImage`
Expected: FAIL — `saveImage is not a function`.

- [ ] **Step 5.3: Implement**

Append to `src/lib/imagePaste.ts`:

```ts
export type SaveImageInput = {
  bytes: Uint8Array
  mime: string
  vaultRoot: string
  docPath: string
  location: ImagesLocation
  template: string
  now?: Date
  rand?: () => string
}

export type SaveImageResult = {
  absolutePath: string
  relativePath: string
}

function isAlreadyExistsError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false
  const msg = (e as { message?: unknown }).message
  return typeof msg === "string" && msg.startsWith("already exists:")
}

const MAX_ATTEMPTS = 4

export async function saveImage(input: SaveImageInput): Promise<SaveImageResult> {
  if (!mimeToExt(input.mime)) {
    throw new Error(`unsupported image MIME: ${input.mime}`)
  }
  const dir = resolveImageDir(input.vaultRoot, input.docPath, input.location)

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const filename = generateFilename(input.mime, input.template, {
      docPath: input.docPath,
      now: input.now,
      rand: input.rand,
    })
    const absolutePath = joinPath(dir, filename)
    try {
      await ipc.writeImage(absolutePath, input.bytes)
      return {
        absolutePath,
        relativePath: relativeFromDocDir(input.docPath, absolutePath),
      }
    } catch (e) {
      if (!isAlreadyExistsError(e)) throw e
      // else fall through and retry with a new filename
    }
  }
  throw new Error("Couldn't pick a unique filename — try again")
}
```

- [ ] **Step 5.4: Run, expect pass**

Run: `pnpm test src/lib/__tests__/imagePaste.test.ts`
Expected: all tests in the file pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/imagePaste.ts src/lib/__tests__/imagePaste.test.ts
git commit -m "Add imagePaste helper: dir resolution, filename templates, save"
```

---

## Task 5: Tauri asset protocol

**Files:**
- Modify: `src-tauri/tauri.conf.json`
- Modify: `src-tauri/capabilities/default.json`

- [ ] **Step 1: Enable the asset protocol**

In `src-tauri/tauri.conf.json`, change the `app.security` block to include `assetProtocol`:

```json
    "security": {
      "csp": null,
      "assetProtocol": {
        "enable": true,
        "scope": ["**"]
      }
    }
```

The full `app` block should look like:

```json
  "app": {
    "windows": [
      {
        "title": "mdwriter",
        "width": 800,
        "height": 600
      }
    ],
    "security": {
      "csp": null,
      "assetProtocol": {
        "enable": true,
        "scope": ["**"]
      }
    }
  },
```

- [ ] **Step 2: Allow the asset permission for the main window**

In `src-tauri/capabilities/default.json`, add `"core:webview:default"` and `"core:window:default"` if not already there, plus the asset path read permission. Update the file to:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Capability for the main window",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "opener:default",
    "dialog:default",
    "dialog:allow-open",
    "shell:default"
  ]
}
```

The `core:default` set already grants asset-protocol access when the scope is configured in `tauri.conf.json`, so no permission change is strictly required here. **Skip the capabilities edit unless a runtime error mentions an asset permission.**

- [ ] **Step 3: Smoke check**

The change is configuration-only — the proof comes when an image actually renders in Task 7. For now just verify Tauri still builds:

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/tauri.conf.json
git commit -m "Enable Tauri asset protocol for pasted image previews"
```

---

## Task 6: BlockEditor — wire `uploadFile` and `resolveFileUrl`

**Files:**
- Modify: `src/features/editor/BlockEditor.tsx`

- [ ] **Step 1: Replace `BlockEditor.tsx`**

Overwrite `src/features/editor/BlockEditor.tsx` with:

```tsx
import { useEffect, useMemo, useRef } from "react"
import type { BlockNoteEditor, PartialBlock } from "@blocknote/core"
import { useCreateBlockNote } from "@blocknote/react"
import { BlockNoteView } from "@blocknote/mantine"
import "@blocknote/mantine/style.css"
import { convertFileSrc } from "@tauri-apps/api/core"
import { useResolvedTheme } from "../settings/useTheme"
import { useStore } from "../../lib/store"
import { saveImage } from "../../lib/imagePaste"

function parentDir(p: string): string {
  const idx = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"))
  return idx <= 0 ? "" : p.slice(0, idx)
}

function resolveAgainstDocDir(docPath: string, rel: string): string {
  if (rel.startsWith("/") || /^[A-Za-z]:[\\/]/.test(rel)) return rel
  const sep = docPath.includes("\\") ? "\\" : "/"
  const segs = [...parentDir(docPath).split(/[\\/]/).filter(Boolean), ...rel.split("/").filter(Boolean)]
  const stack: string[] = []
  for (const s of segs) {
    if (s === "..") stack.pop()
    else if (s !== ".") stack.push(s)
  }
  const prefix = docPath.startsWith("/") ? "/" : ""
  return prefix + stack.join(sep)
}

export function BlockEditor({
  initialMarkdown,
  onChangeMarkdown,
  docKey,
}: {
  initialMarkdown: string
  onChangeMarkdown: (md: string) => void
  docKey: string
}) {
  const initializedKey = useRef<string | null>(null)
  const lastEmitted = useRef<string>("")
  const theme = useResolvedTheme()

  // Capture the latest values inside refs so the BlockNote callbacks
  // (created once below) always see fresh settings + paths.
  const docPathRef = useRef(docKey)
  docPathRef.current = docKey
  const vaultRootRef = useRef<string | null>(useStore.getState().rootPath)
  vaultRootRef.current = useStore((s) => s.rootPath)
  const locationRef = useRef(useStore.getState().settings.imagesLocation)
  locationRef.current = useStore((s) => s.settings.imagesLocation)
  const templateRef = useRef(useStore.getState().settings.imageFilenameTemplate)
  templateRef.current = useStore((s) => s.settings.imageFilenameTemplate)

  const editor = useCreateBlockNote(
    useMemo(
      () => ({
        uploadFile: async (file: File): Promise<string> => {
          const vaultRoot = vaultRootRef.current
          const docPath = docPathRef.current
          if (!vaultRoot || !docPath) throw new Error("No vault or doc context")
          const bytes = new Uint8Array(await file.arrayBuffer())
          const mime = file.type || "application/octet-stream"
          const result = await saveImage({
            bytes,
            mime,
            vaultRoot,
            docPath,
            location: locationRef.current,
            template: templateRef.current,
          })
          return result.relativePath
        },
        resolveFileUrl: async (stored: string): Promise<string> => {
          if (/^https?:\/\//i.test(stored)) return stored
          if (stored.startsWith("asset:") || stored.startsWith("data:")) return stored
          const absolute = resolveAgainstDocDir(docPathRef.current, stored)
          return convertFileSrc(absolute)
        },
      }),
      [],
    ),
  )

  useEffect(() => {
    if (initializedKey.current === docKey) return
    initializedKey.current = docKey
    ;(async () => {
      const blocks = (await editor.tryParseMarkdownToBlocks(initialMarkdown)) as PartialBlock[]
      editor.replaceBlocks(editor.document, blocks.length ? blocks : [{ type: "paragraph" }])
      lastEmitted.current = initialMarkdown
    })()
  }, [docKey, initialMarkdown, editor])

  return (
    <div className="h-full overflow-y-auto">
      <BlockNoteView
        editor={editor as BlockNoteEditor}
        theme={theme}
        onChange={async () => {
          const md = await editor.blocksToMarkdownLossy(editor.document)
          if (md !== lastEmitted.current) {
            lastEmitted.current = md
            onChangeMarkdown(md)
          }
        }}
      />
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Verify existing tests still pass**

Run: `pnpm test`
Expected: all tests pass.

- [ ] **Step 4: Manual smoke**

Run: `pnpm tauri dev`

In the running app:
1. Open a vault and a note.
2. Take a screenshot (Cmd+Shift+4 → spacebar → click a window on macOS) to put a PNG on the clipboard.
3. Click into the note body and press Cmd+V.
4. Expect: the image appears inline. A new file `assets/2026-05-10-xxxxxx-XXXX.png` exists under the vault root.
5. Read the saved `.md` file from disk — body contains `![](assets/...png)`.

Note any failures. If the image renders as a broken icon, re-check Task 5 (asset protocol). If the paste silently fails, open the devtools console and look for the error from `uploadFile`.

- [ ] **Step 5: Commit**

```bash
git add src/features/editor/BlockEditor.tsx
git commit -m "Wire BlockNote uploadFile and resolveFileUrl for image paste"
```

---

## Task 7: `useRawImagePaste` hook + RawEditor wiring

**Files:**
- Create: `src/features/editor/useRawImagePaste.ts`
- Modify: `src/features/editor/RawEditor.tsx`

- [ ] **Step 1: Create the hook**

Create `src/features/editor/useRawImagePaste.ts`:

```ts
import { useEffect } from "react"
import type { EditorView } from "@codemirror/view"
import { useStore } from "../../lib/store"
import { saveImage, mimeToExt } from "../../lib/imagePaste"

function firstImageFile(files: FileList | DataTransferItemList | null): File | null {
  if (!files) return null
  if (files instanceof FileList) {
    for (const f of Array.from(files)) {
      if (mimeToExt(f.type)) return f
    }
    return null
  }
  // DataTransferItemList
  for (const item of Array.from(files)) {
    if (item.kind === "file") {
      const f = item.getAsFile()
      if (f && mimeToExt(f.type)) return f
    }
  }
  return null
}

async function handleFile(view: EditorView, file: File): Promise<void> {
  const { rootPath, openDoc, settings } = useStore.getState()
  if (!rootPath || !openDoc) return
  const bytes = new Uint8Array(await file.arrayBuffer())
  const result = await saveImage({
    bytes,
    mime: file.type || "application/octet-stream",
    vaultRoot: rootPath,
    docPath: openDoc.path,
    location: settings.imagesLocation,
    template: settings.imageFilenameTemplate,
  })
  const insert = `![](${result.relativePath})`
  const { from, to } = view.state.selection.main
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + insert.length },
  })
  view.focus()
}

export function useRawImagePaste(viewRef: React.MutableRefObject<EditorView | null>): void {
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const host = view.dom

    function onPaste(e: ClipboardEvent) {
      const file = firstImageFile(e.clipboardData?.items ?? null)
      if (!file) return
      e.preventDefault()
      void handleFile(view!, file).catch((err) => {
        console.error("paste image failed", err)
      })
    }

    function onDrop(e: DragEvent) {
      const file = firstImageFile(e.dataTransfer?.files ?? null)
      if (!file) return
      e.preventDefault()
      void handleFile(view!, file).catch((err) => {
        console.error("drop image failed", err)
      })
    }

    host.addEventListener("paste", onPaste)
    host.addEventListener("drop", onDrop)
    return () => {
      host.removeEventListener("paste", onPaste)
      host.removeEventListener("drop", onDrop)
    }
  }, [viewRef])
}
```

- [ ] **Step 2: Wire it into `RawEditor`**

Modify `src/features/editor/RawEditor.tsx` to call the hook. Replace the file with:

```tsx
import { useEffect, useRef } from "react"
import { EditorState } from "@codemirror/state"
import { EditorView, keymap, lineNumbers } from "@codemirror/view"
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands"
import { markdown } from "@codemirror/lang-markdown"
import { useRawImagePaste } from "./useRawImagePaste"

export function RawEditor({
  value,
  onChange,
}: {
  value: string
  onChange: (next: string) => void
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)

  useEffect(() => {
    if (!hostRef.current) return
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          lineNumbers(),
          markdown(),
          EditorView.theme({ "&": { height: "100%" } }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onChange(u.state.doc.toString())
          }),
        ],
      }),
    })
    viewRef.current = view
    return () => { view.destroy(); viewRef.current = null }
  }, [])

  // Sync external value changes (file switch).
  useEffect(() => {
    const v = viewRef.current
    if (!v) return
    if (v.state.doc.toString() !== value) {
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } })
    }
  }, [value])

  useRawImagePaste(viewRef)

  return <div ref={hostRef} className="h-full overflow-auto" />
}
```

- [ ] **Step 3: Verify TypeScript compiles and unit tests pass**

Run: `pnpm exec tsc --noEmit`
Run: `pnpm test`
Expected: both pass.

- [ ] **Step 4: Manual smoke**

Run: `pnpm tauri dev`

1. Open a note, press Cmd+E to switch to raw mode.
2. Take a screenshot, click into the raw editor, press Cmd+V.
3. Expect: `![](assets/2026-05-10-xxxxxx-XXXX.png)` appears at the cursor; a new PNG exists under `assets/`.
4. Switch back to block mode (Cmd+E). The image now displays inline (BlockNote will resolve it through `resolveFileUrl`).
5. Drag an image file from Finder into the raw editor: same behavior.

- [ ] **Step 5: Commit**

```bash
git add src/features/editor/useRawImagePaste.ts src/features/editor/RawEditor.tsx
git commit -m "Add raw-mode image paste/drop with cursor insertion"
```

---

## Task 8: Settings UI — "Images" section

**Files:**
- Modify: `src/features/settings/SettingsPanel.tsx`

- [ ] **Step 1: Add the Images section**

In `src/features/settings/SettingsPanel.tsx`, add a new section after `<Section title="Vault Content">` and before `<Section title="About">`. Just before the closing `</Section>` of "Vault Content", and the opening of "About", insert:

```tsx
          <Section title="Images">
            <div className="flex items-start gap-4 py-3">
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium text-text">Storage location</div>
                <div className="text-[12px] text-text-subtle mt-0.5 leading-relaxed">
                  Where pasted or dropped images are saved inside the vault.
                </div>
              </div>
              <ImagesLocationSegmented
                value={settings.imagesLocation}
                onChange={(v) => setSetting("imagesLocation", v)}
              />
            </div>
            <Divider />
            <div className="flex flex-col gap-2 py-3">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-medium text-text">Filename template</div>
                  <div className="text-[12px] text-text-subtle mt-0.5 leading-relaxed">
                    Tokens:{" "}
                    <code className="font-mono">{"{date}"}</code>{" "}
                    <code className="font-mono">{"{time}"}</code>{" "}
                    <code className="font-mono">{"{rand}"}</code>{" "}
                    <code className="font-mono">{"{note}"}</code>.
                    Extension is added automatically from the image type.
                  </div>
                </div>
              </div>
              <input
                type="text"
                value={settings.imageFilenameTemplate}
                onChange={(e) => setSetting("imageFilenameTemplate", e.target.value)}
                placeholder="{date}-{time}-{rand}"
                className="w-full px-2 py-1 rounded border border-border bg-surface text-[13px] font-mono text-text"
              />
            </div>
          </Section>
```

- [ ] **Step 2: Add the segmented control component**

At the bottom of the same file (alongside `ThemeSegmented`), add:

```tsx
function ImagesLocationSegmented({
  value, onChange,
}: { value: ImagesLocation; onChange: (v: ImagesLocation) => void }) {
  const opts: Array<{ value: ImagesLocation; label: string }> = [
    { value: "vault-assets", label: "Vault assets" },
    { value: "sibling-assets", label: "Sibling folder" },
    { value: "same-folder", label: "Same folder" },
  ]
  return (
    <div className="inline-flex rounded-md border border-border bg-surface p-0.5 mt-0.5">
      {opts.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={[
              "px-2.5 h-7 rounded text-[12px] transition-colors",
              active
                ? "bg-accent text-accent-fg"
                : "text-text-subtle hover:text-text hover:bg-elevated",
            ].join(" ")}
            aria-pressed={active}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 3: Update the imports**

Add `ImagesLocation` to the existing `import { useStore, type Theme } from "../../lib/store"` line:

```tsx
import { useStore, type Theme, type ImagesLocation } from "../../lib/store"
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Manual smoke**

Run: `pnpm tauri dev`

1. Press Cmd+, to open Settings.
2. Find the new "Images" section.
3. Switch to "Sibling folder", paste a screenshot — file lands in `<note>.assets/`.
4. Switch to "Same folder", paste another — file lands next to the .md.
5. Change template to `{note}-{rand}`, paste — filename starts with the note slug.

- [ ] **Step 6: Commit**

```bash
git add src/features/settings/SettingsPanel.tsx
git commit -m "Add Settings UI for image storage location and filename template"
```

---

## Task 9: Final verification

- [ ] **Step 1: Run all tests**

```bash
pnpm test
cargo test --manifest-path src-tauri/Cargo.toml --lib
pnpm test:e2e
```

Expected: all green.

- [ ] **Step 2: Run typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Acceptance criteria walkthrough**

Open the app (`pnpm tauri dev`) and verify each acceptance criterion from the spec §11:

1. Screenshot → paste → block mode → image renders, file in `assets/`. ✓
2. `.md` file on disk contains `![](assets/<name>.png)`. ✓
3. Drag image from Finder → same result. ✓
4. `https://example.com/x.png` text paste → remote image block; no new file. ✓
5. Both paste and drag-drop work in raw mode and insert literal markdown. ✓
6. Changing the Images-location setting changes future pastes only. ✓
7. With "Show Images" off, pasted images don't appear in the tree but do render inline. ✓
8. All test suites pass. ✓

- [ ] **Step 4: Final commit (if any cleanup)**

If any lint/format/test fixes were needed during the walkthrough, commit them:

```bash
git add -A
git commit -m "Polish copy-paste images feature"
```

---

## Verification Commands Reference

| What | Command |
|---|---|
| Rust unit | `cargo test --manifest-path src-tauri/Cargo.toml --lib` |
| TS unit | `pnpm test` |
| TS one file | `pnpm test src/lib/__tests__/imagePaste.test.ts` |
| TS one test | `pnpm test -t "mimeToExt"` |
| TS typecheck | `pnpm exec tsc --noEmit` |
| E2E smoke | `pnpm test:e2e` |
| Dev app | `pnpm tauri dev` |
