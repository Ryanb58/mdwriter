import { describe, expect, it } from "vitest"
import {
  parseDoc,
  getBody,
  setBody,
  getFrontmatterValues,
  setFrontmatterField,
  removeFrontmatterField,
} from "../doc"

describe("parseDoc", () => {
  it("returns empty frontmatter for a file with no frontmatter", () => {
    const r = parseDoc("# Hello\n")
    expect(r.frontmatterRange).toBeNull()
    expect(r.values).toEqual({})
    expect(r.body).toBe("# Hello\n")
    expect(r.parseError).toBeNull()
  })

  it("identifies frontmatter range and parses values", () => {
    const text = "---\ntitle: T\ncount: 3\nflag: true\n---\n\n# Body\n"
    const r = parseDoc(text)
    expect(r.frontmatterRange).not.toBeNull()
    expect(r.values).toEqual({ title: "T", count: 3, flag: true })
    expect(r.body).toBe("# Body\n")
  })

  it("preserves array values", () => {
    const text = "---\ntags:\n  - a\n  - b\n---\n\nbody"
    const r = parseDoc(text)
    expect(r.values).toEqual({ tags: ["a", "b"] })
    expect(r.body).toBe("body")
  })

  it("frontmatter range spans through the trailing blank line", () => {
    const text = "---\nt: 1\n---\n\nbody"
    const r = parseDoc(text)
    // The blank line between `---` and `body` is conventionally part of
    // the frontmatter region — body starts at "body".
    expect(text.slice(r.frontmatterRange!.end)).toBe("body")
  })

  it("skips unparseable lines lenient-style", () => {
    // Mirror prior parseSimpleYaml behavior: lines that aren't key:value
    // (e.g. inline-JSON nested values written by combineRaw's JSON
    // fallback path) are dropped, not flipped to parseError. Files that
    // worked before this refactor continue to work.
    const text = '---\nnested: {"a":1}\ntitle: T\n---\nbody'
    const r = parseDoc(text)
    expect(r.parseError).toBeNull()
    // `nested` is parsed because the line shape matches key:value; the
    // value is captured as a string. The point is just that parsing
    // doesn't fail on shapes we can't fully model.
    expect(r.values.title).toBe("T")
    expect(r.body).toBe("body")
  })

  it("handles files with no trailing newline at EOF", () => {
    // gray_matter accepts these on the Rust side; the new model has to
    // match.
    const text = "---\nt: 1\n---\n\nbody"
    const r = parseDoc(text)
    expect(r.values).toEqual({ t: 1 })
    expect(r.body).toBe("body")
  })

  it("handles a body that doesn't end with a newline", () => {
    const text = "---\nt: 1\n---\n\n# H"
    const r = parseDoc(text)
    expect(r.body).toBe("# H")
  })

  it("handles frontmatter with no trailing blank line before body", () => {
    const text = "---\nt: 1\n---\nbody"
    const r = parseDoc(text)
    expect(r.values).toEqual({ t: 1 })
    expect(r.body).toBe("body")
  })
})

describe("getBody / setBody", () => {
  it("getBody returns text minus frontmatter region", () => {
    const text = "---\nt: 1\n---\n\n# B\n"
    expect(getBody(text)).toBe("# B\n")
  })

  it("setBody preserves frontmatter region byte-for-byte", () => {
    const fmRegion = "---\nfoo: 1\ntags:\n  - x\n  - y\n---\n\n"
    const text = `${fmRegion}# old body\n`
    const next = setBody(text, "# new body\n")
    expect(next.startsWith(fmRegion)).toBe(true)
    expect(next).toBe(`${fmRegion}# new body\n`)
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
    expect(getBody(next)).toBe("body")
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
    expect(getBody(next)).toBe("body")
  })

  it("removing the last field removes the entire frontmatter block", () => {
    const text = "---\ntitle: T\n---\n\nbody"
    const next = removeFrontmatterField(text, "title")
    expect(parseDoc(next).frontmatterRange).toBeNull()
    expect(getBody(next)).toBe("body")
  })

  it("removing a non-existent field is a no-op", () => {
    const text = "---\ntitle: T\n---\n\nbody"
    expect(removeFrontmatterField(text, "nope")).toBe(text)
  })
})

describe("getFrontmatterValues", () => {
  it("returns empty object when there's no frontmatter", () => {
    expect(getFrontmatterValues("# Hi\n")).toEqual({})
  })

  it("returns the parsed values", () => {
    expect(getFrontmatterValues("---\na: 1\nb: hi\n---\nbody"))
      .toEqual({ a: 1, b: "hi" })
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

describe("invariant: idempotent operations", () => {
  it("setFrontmatterField with the same value is a no-op on body", () => {
    const text = "---\nt: T\n---\n\nbody"
    expect(setFrontmatterField(text, "t", "T")).toBe(text)
  })

  it("setBody with the current body is a no-op on text", () => {
    const text = "---\nt: 1\n---\n\nbody"
    expect(setBody(text, "body")).toBe(text)
  })
})
