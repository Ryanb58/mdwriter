import { describe, expect, it } from "vitest"
import { isPermissionDenied } from "../ToolActionCard"

describe("isPermissionDenied", () => {
  it("matches Claude Code's bash approval phrase", () => {
    expect(isPermissionDenied("This command requires approval")).toBe(true)
  })

  it("matches the skill read permission phrase", () => {
    expect(
      isPermissionDenied(
        "Claude requested permissions to read from /Users/x/.claude/skills/foo/SKILL.md, but you haven't granted it yet.",
      ),
    ).toBe(true)
  })

  it("matches array-of-text-blocks payloads (Claude Code's stream-json shape)", () => {
    const blocks = [{ text: "Tool execution failed: permission denied for Bash" }]
    expect(isPermissionDenied(blocks)).toBe(true)
  })

  it("is case-insensitive", () => {
    expect(isPermissionDenied("REQUIRES APPROVAL")).toBe(true)
  })

  it("ignores unrelated tool errors", () => {
    expect(isPermissionDenied("File not found: /a/b/c.md")).toBe(false)
    expect(isPermissionDenied("Syntax error in YAML at line 3")).toBe(false)
    expect(isPermissionDenied("")).toBe(false)
    expect(isPermissionDenied(null)).toBe(false)
  })

  it("does not flag generic phrases like 'permission to write'", () => {
    // We deliberately dropped the loose 'permission to' substring to avoid
    // matching unrelated error text. Phrasing here would be a false positive.
    expect(isPermissionDenied("user lacks permission to write")).toBe(false)
  })
})
