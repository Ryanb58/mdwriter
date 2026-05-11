import { describe, it, expect } from "vitest"
import { classifyImports } from "../importExecutor"

function f(name: string): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type: "" })
}

describe("classifyImports", () => {
  it("accepts markdown and image files", () => {
    const { accepted, skipped } = classifyImports([
      f("note.md"),
      f("Capture.MARKDOWN"),
      f("pic.png"),
      f("photo.JPG"),
      f("vector.svg"),
    ])
    expect(accepted.map((x) => x.name)).toEqual([
      "note.md",
      "Capture.MARKDOWN",
      "pic.png",
      "photo.JPG",
      "vector.svg",
    ])
    expect(skipped).toHaveLength(0)
  })

  it("rejects unsupported and extensionless files", () => {
    const { accepted, skipped } = classifyImports([
      f("a.md"),
      f("readme.txt"),
      f("script.js"),
      f("LICENSE"),
    ])
    expect(accepted.map((x) => x.name)).toEqual(["a.md"])
    expect(skipped.map((x) => x.name)).toEqual(["readme.txt", "script.js", "LICENSE"])
    expect(skipped.find((s) => s.name === "LICENSE")!.reason).toMatch(/no extension/i)
  })
})
