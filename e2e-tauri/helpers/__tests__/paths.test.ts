import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"
import {
  assertSafeTestApplicationSupportTarget,
  resetTestApplicationSupport,
} from "../paths"

const homeDirectory = "/Users/integration-test"
const applicationSupportDirectory = join(
  homeDirectory,
  "Library",
  "Application Support",
)
const testStateDirectory = join(
  applicationSupportDirectory,
  "dev.mdwriter.editor.e2e",
)

describe("Tauri integration-test state isolation", () => {
  it("removes exactly the isolated Application Support child", () => {
    const removeDirectory = vi.fn()

    expect(
      resetTestApplicationSupport({ homeDirectory, removeDirectory }),
    ).toBe(testStateDirectory)
    expect(removeDirectory).toHaveBeenCalledOnce()
    expect(removeDirectory).toHaveBeenCalledWith(testStateDirectory)
  })

  it.each([
    ["the home directory", homeDirectory],
    ["Application Support itself", applicationSupportDirectory],
    [
      "the production application state",
      join(applicationSupportDirectory, "dev.mdwriter.editor"),
    ],
    ["a nested child", join(testStateDirectory, "nested")],
    [
      "an Application Support sibling",
      join(homeDirectory, "Library", "dev.mdwriter.editor.e2e"),
    ],
  ])("refuses %s", (_description, targetDirectory) => {
    expect(() =>
      assertSafeTestApplicationSupportTarget(
        applicationSupportDirectory,
        targetDirectory,
      ),
    ).toThrow(/refusing to remove unexpected Tauri integration state/)
  })
})
