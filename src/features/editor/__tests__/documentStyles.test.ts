import { describe, expect, it } from "vitest"
import { documentStylesheetPaths } from "../documentStyles"

const ROOT = "/vault"
const NOTE = "/vault/notes/plan.md"

describe("documentStylesheetPaths", () => {
  it("cascades the global sheet, declared relative sheets, then the sidecar", () => {
    expect(documentStylesheetPaths(
      "---\ncss:\n  - ../shared.css\n  - plan.css\n---\n\n# Plan",
      NOTE,
      ROOT,
    )).toEqual([
      "/vault/markdown.css",
      "/vault/notes/../shared.css",
      "/vault/notes/plan.css",
      "/vault/notes/plan.md.css",
    ])
  })

  it("accepts a scalar css value and ignores absolute paths and non-CSS values", () => {
    expect(documentStylesheetPaths(
      "---\ncss: note.css\n---\n\n# Plan",
      NOTE,
      ROOT,
    )).toEqual(["/vault/markdown.css", "/vault/notes/note.css", "/vault/notes/plan.md.css"])

    expect(documentStylesheetPaths(
      "---\ncss:\n  - /tmp/no.css\n  - https://example.com/no.css\n  - colors.txt\n---\n\n# Plan",
      NOTE,
      ROOT,
    )).toEqual(["/vault/markdown.css", "/vault/notes/plan.md.css"])
  })

  it("deduplicates a sidecar explicitly named in frontmatter", () => {
    expect(documentStylesheetPaths(
      "---\ncss: plan.md.css\n---\n\n# Plan",
      NOTE,
      ROOT,
    )).toEqual(["/vault/markdown.css", "/vault/notes/plan.md.css"])
  })
})
