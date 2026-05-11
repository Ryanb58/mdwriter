import { describe, expect, it } from "vitest"
import { __test__ } from "../CommandPalette"

const { detectModeFromQuery } = __test__

describe("detectModeFromQuery", () => {
  it("stays in file mode for normal queries", () => {
    expect(detectModeFromQuery("note")).toEqual({ mode: "file", rest: "note" })
  })

  it("switches to ask mode on leading > and space", () => {
    expect(detectModeFromQuery("> hello")).toEqual({ mode: "ask", rest: "hello" })
  })

  it("switches to ask mode on leading space", () => {
    expect(detectModeFromQuery(" what's new")).toEqual({ mode: "ask", rest: "what's new" })
  })

  it("does not switch on mid-string `>` or space", () => {
    expect(detectModeFromQuery("a > b")).toEqual({ mode: "file", rest: "a > b" })
  })
})
