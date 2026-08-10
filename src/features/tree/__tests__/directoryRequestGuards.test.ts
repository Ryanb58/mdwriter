import { describe, expect, it } from "vitest"
import { DirectoryRequestGuards } from "../directoryRequestGuards"

describe("DirectoryRequestGuards", () => {
  it("releases a completed request without making an older token current", () => {
    const guards = new DirectoryRequestGuards()
    const oldToken = guards.begin("/vault\0/vault/notes")
    const currentToken = guards.begin("/vault\0/vault/notes")

    guards.finish("/vault\0/vault/notes", currentToken)

    expect(guards.isCurrent("/vault\0/vault/notes", currentToken)).toBe(false)
    expect(guards.isCurrent("/vault\0/vault/notes", oldToken)).toBe(false)
  })

  it("invalidates only requests belonging to the selected vault", () => {
    const guards = new DirectoryRequestGuards()
    const vaultToken = guards.begin("/vault\0/vault/notes")
    const otherToken = guards.begin("/other\0/other/notes")

    guards.invalidateRoot("/vault")

    expect(guards.isCurrent("/vault\0/vault/notes", vaultToken)).toBe(false)
    expect(guards.isCurrent("/other\0/other/notes", otherToken)).toBe(true)
  })
})
