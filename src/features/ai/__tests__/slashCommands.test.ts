import { describe, expect, it } from "vitest"
import { SLASH_COMMANDS, detectSlashTrigger, matchSlashCommands } from "../slashCommands"

describe("detectSlashTrigger", () => {
  it("matches an empty trigger", () => {
    expect(detectSlashTrigger("/")).toBe("")
  })

  it("matches a partial command", () => {
    expect(detectSlashTrigger("/sum")).toBe("sum")
  })

  it("returns null when text doesn't start with /", () => {
    expect(detectSlashTrigger("sum /things")).toBeNull()
  })

  it("returns null once whitespace appears", () => {
    expect(detectSlashTrigger("/sum this")).toBeNull()
  })
})

describe("matchSlashCommands", () => {
  it("returns every command for an empty query", () => {
    expect(matchSlashCommands("")).toHaveLength(SLASH_COMMANDS.length)
  })

  it("prefix-matches by name", () => {
    const out = matchSlashCommands("sum")
    expect(out.map((c) => c.name)).toContain("summarize")
  })

  it("substring-matches the label or hint", () => {
    const out = matchSlashCommands("clarity")
    expect(out.map((c) => c.name)).toContain("rewrite")
  })
})

describe("command builders", () => {
  it("summarize references the current note when one is open", () => {
    const cmd = SLASH_COMMANDS.find((c) => c.name === "summarize")!
    const out = cmd.build({ currentNoteName: "notes.md", hasSelection: false })
    expect(out).toContain("notes.md")
  })

  it("rewrite mentions selection when one is attached", () => {
    const cmd = SLASH_COMMANDS.find((c) => c.name === "rewrite")!
    const out = cmd.build({ currentNoteName: null, hasSelection: true })
    expect(out.toLowerCase()).toContain("selected")
  })
})
