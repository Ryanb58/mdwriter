import { describe, it, expect } from "vitest"
import { inferType } from "../inferType"

describe("inferType", () => {
  it("detects primitives", () => {
    expect(inferType("hello")).toBe("string")
    expect(inferType(42)).toBe("number")
    expect(inferType(true)).toBe("boolean")
    expect(inferType(null)).toBe("null")
    expect(inferType(undefined)).toBe("null")
  })
  it("detects ISO dates", () => {
    expect(inferType("2026-05-09")).toBe("date")
    expect(inferType("2026-05-09T12:00:00Z")).toBe("date")
  })
  it("detects arrays as list, objects as nested", () => {
    expect(inferType(["a"])).toBe("list")
    expect(inferType({ a: 1 })).toBe("nested")
  })
})
