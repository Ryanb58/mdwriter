import { describe, it, expect } from "vitest"
import { extractFirstH1, extractCommittedH1, slugify } from "../useAutoRename"

describe("extractFirstH1", () => {
  it("returns the first heading text", () => {
    expect(extractFirstH1("# Hello world\n\nbody")).toBe("Hello world")
  })

  it("ignores a '#' inside frontmatter", () => {
    expect(extractFirstH1("---\ntitle: # not a heading\n---\n# Real\n")).toBe("Real")
  })

  it("returns null for an empty heading marker", () => {
    expect(extractFirstH1("# ")).toBeNull()
  })

  it("returns null when there is no heading", () => {
    expect(extractFirstH1("just some text")).toBeNull()
  })
})

describe("extractCommittedH1", () => {
  it("does not commit while the heading is the only/last line", () => {
    // This is the mid-typing case: "2026-06" on the way to "2026-06-06".
    expect(extractCommittedH1("# 2026-06")).toBeNull()
  })

  it("does not commit for a heading with a single trailing newline", () => {
    // BlockNote's export and one raw-mode Enter both produce a lone "\n";
    // that's ambiguous, so we keep waiting.
    expect(extractCommittedH1("# 2026-06\n")).toBeNull()
  })

  it("commits once an empty line follows (Enter pressed)", () => {
    expect(extractCommittedH1("# 2026-06-06\n\n")).toBe("2026-06-06")
  })

  it("commits once body content follows", () => {
    expect(extractCommittedH1("# 2026-06-06\n\nthe body")).toBe("2026-06-06")
  })

  it("commits when a second line directly follows", () => {
    expect(extractCommittedH1("# Title\nmore")).toBe("Title")
  })

  it("ignores frontmatter when deciding commitment", () => {
    expect(extractCommittedH1("---\ntags: x\n---\n# Title\n\nbody")).toBe("Title")
  })
})

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("My Cool Note")).toBe("my-cool-note")
  })

  it("keeps date hyphens intact", () => {
    expect(slugify("2026-06-06")).toBe("2026-06-06")
  })

  it("strips punctuation and collapses separators", () => {
    expect(slugify("Hello, World!!  Again")).toBe("hello-world-again")
  })

  it("strips accents", () => {
    expect(slugify("Café déjà vu")).toBe("cafe-deja-vu")
  })
})
