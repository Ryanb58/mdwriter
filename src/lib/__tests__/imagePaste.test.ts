import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}))

import { invoke } from "@tauri-apps/api/core"
import {
  mimeToExt,
  guessMimeFromName,
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

describe("guessMimeFromName", () => {
  it("maps common image extensions", () => {
    expect(guessMimeFromName("foo.png")).toBe("image/png")
    expect(guessMimeFromName("FOO.JPG")).toBe("image/jpeg")
    expect(guessMimeFromName("foo.jpeg")).toBe("image/jpeg")
    expect(guessMimeFromName("path/to/img.webp")).toBe("image/webp")
  })

  it("returns null for unknown or missing extensions", () => {
    expect(guessMimeFromName("foo")).toBeNull()
    expect(guessMimeFromName("foo.heic")).toBeNull()
    expect(guessMimeFromName("")).toBeNull()
  })
})

describe("resolveImageDir", () => {
  it("vault-assets returns <vault>/assets regardless of note depth", () => {
    expect(resolveImageDir("/Vault", "/Vault/note.md", "vault-assets"))
      .toBe("/Vault/assets")
    expect(resolveImageDir("/Vault", "/Vault/sub/deep/note.md", "vault-assets"))
      .toBe("/Vault/assets")
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

describe("generateFilename", () => {
  const now = new Date("2026-05-10T14:30:52")
  const rand = () => "a3f1"

  it("default template produces YYYY-MM-DD-HHMMSS-<hex>.<ext>", () => {
    const name = generateFilename("image/png", "{date}-{time}-{rand}", {
      docPath: "/Vault/note.md",
      now,
      rand,
    })
    expect(name).toBe("2026-05-10-143052-a3f1.png")
  })

  it("supports {note} token with slugified note stem", () => {
    const name = generateFilename("image/png", "{note}-{rand}", {
      docPath: "/Vault/My Post! Title.md",
      now,
      rand,
    })
    expect(name).toBe("my-post-title-a3f1.png")
  })

  it("leaves unknown tokens literal", () => {
    const name = generateFilename("image/png", "{date}-{xyz}-{rand}", {
      docPath: "/Vault/note.md",
      now,
      rand,
    })
    expect(name).toBe("2026-05-10-{xyz}-a3f1.png")
  })

  it("strips illegal filename characters", () => {
    const name = generateFilename("image/png", "a<b>c:d/e\\f|g.h", {
      docPath: "/Vault/note.md",
      now,
      rand,
    })
    expect(name).toBe("abcdefg.h.png")
  })

  it("falls back to default template when sanitized template is empty", () => {
    const name = generateFilename("image/png", "///", {
      docPath: "/Vault/note.md",
      now,
      rand,
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
      docPath: "/note.md",
      now,
      rand,
    })
    expect(name).toBe("a3f1.jpg")
  })
})

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
      // Bytes are base64-encoded; assert shape, not exact encoding.
      bytesB64: expect.any(String),
    })
  })

  it("appends -1, -2, … on collision", async () => {
    let n = 0
    vi.mocked(invoke).mockImplementation(async () => {
      if (n++ === 0) throw { kind: "Io", message: "already exists: /Vault/assets/a3f1.png" }
    })
    const result = await saveImage({
      bytes: new Uint8Array([0]),
      mime: "image/png",
      vaultRoot: "/Vault",
      docPath: "/Vault/note.md",
      location: "vault-assets",
      template: "{rand}",
      now: new Date("2026-05-10T14:30:52"),
      rand: () => "a3f1",
    })
    expect(result.relativePath).toBe("assets/a3f1-1.png")
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
