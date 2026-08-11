import { mkdirSync } from "node:fs"
import { join } from "node:path"

const artifactDirectory = join("test-results", "tauri")

type CaptureFailureScreenshotOptions = {
  passed: boolean
  testName: string
  saveScreenshot: (path: string) => Promise<unknown>
  ensureDirectory?: (directory: string) => void
  reportCaptureError?: (error: unknown) => void
}

function sanitizeScreenshotName(testName: string): string {
  const safeName = testName
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120)

  return safeName || "failed-test"
}

export async function captureFailureScreenshot({
  passed,
  testName,
  saveScreenshot,
  ensureDirectory = (directory) => mkdirSync(directory, { recursive: true }),
  reportCaptureError = (error) =>
    console.warn("Unable to capture Tauri test failure screenshot", error),
}: CaptureFailureScreenshotOptions): Promise<void> {
  if (passed) return

  try {
    ensureDirectory(artifactDirectory)
    await saveScreenshot(
      join(artifactDirectory, `${sanitizeScreenshotName(testName)}.png`),
    )
  } catch (error) {
    reportCaptureError(error)
  }
}
