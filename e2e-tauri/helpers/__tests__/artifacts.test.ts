import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { captureFailureScreenshot } from "../artifacts"

describe("Tauri integration-test failure screenshots", () => {
  it("captures a failed test under the artifact directory with a safe name", async () => {
    const preparedDirectories: string[] = []
    const screenshotPaths: string[] = []

    await captureFailureScreenshot({
      passed: false,
      testName: "filesystem / writes: ../../ unsafe? *",
      ensureDirectory: (directory) => preparedDirectories.push(directory),
      saveScreenshot: async (path) => {
        screenshotPaths.push(path)
      },
    })

    expect(preparedDirectories).toEqual([join("test-results", "tauri")])
    expect(screenshotPaths).toEqual([
      join("test-results", "tauri", "filesystem-writes-unsafe.png"),
    ])
  })

  it("does not capture a passing test", async () => {
    let attemptedCapture = false

    await captureFailureScreenshot({
      passed: true,
      testName: "passing test",
      ensureDirectory: () => {
        attemptedCapture = true
      },
      saveScreenshot: async () => {
        attemptedCapture = true
      },
    })

    expect(attemptedCapture).toBe(false)
  })

  it("does not mask the test failure when screenshot capture fails", async () => {
    await expect(
      captureFailureScreenshot({
        passed: false,
        testName: "lost session",
        ensureDirectory: () => undefined,
        saveScreenshot: async () => {
          throw new Error("session already closed")
        },
        reportCaptureError: () => undefined,
      }),
    ).resolves.toBeUndefined()
  })
})
