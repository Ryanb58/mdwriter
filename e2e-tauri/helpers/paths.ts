import { accessSync, constants, rmSync } from "node:fs"
import { homedir } from "node:os"
import { basename, dirname, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "../..")
const testApplicationIdentifier: string = "dev.mdwriter.editor.e2e"
const productionApplicationIdentifier: string = "dev.mdwriter.editor"

export const appBinaryPath = join(
  repositoryRoot,
  "src-tauri/target/debug/bundle/macos/mdwriter.app/Contents/MacOS/mdwriter",
)

export function assertAppBinaryExists() {
  try {
    accessSync(appBinaryPath, constants.X_OK)
  } catch {
    throw new Error(
      `Tauri integration app binary is missing at ${appBinaryPath}. Build it with:\n` +
        "VITE_TAURI_INTEGRATION_TEST=1 pnpm tauri build --debug --features tauri-integration-tests --bundles app --config src-tauri/tauri.e2e.conf.json",
    )
  }
}

export function assertSafeTestApplicationSupportTarget(
  applicationSupportDirectory: string,
  targetDirectory: string,
): void {
  const safeApplicationSupportDirectory = resolve(applicationSupportDirectory)
  const safeTargetDirectory = resolve(targetDirectory)
  const targetRelativePath = relative(
    safeApplicationSupportDirectory,
    safeTargetDirectory,
  )
  const expectedTargetDirectory = join(
    safeApplicationSupportDirectory,
    testApplicationIdentifier,
  )
  const productionTargetDirectory = join(
    safeApplicationSupportDirectory,
    productionApplicationIdentifier,
  )

  const isMacApplicationSupportDirectory =
    basename(safeApplicationSupportDirectory) === "Application Support" &&
    basename(dirname(safeApplicationSupportDirectory)) === "Library"
  const isExactlyOneChild =
    targetRelativePath === testApplicationIdentifier &&
    !targetRelativePath.includes(sep)

  if (
    !isMacApplicationSupportDirectory ||
    !isExactlyOneChild ||
    safeTargetDirectory !== expectedTargetDirectory ||
    safeTargetDirectory === productionTargetDirectory ||
    testApplicationIdentifier === productionApplicationIdentifier
  ) {
    throw new Error(
      `refusing to remove unexpected Tauri integration state: ${safeTargetDirectory}`,
    )
  }
}

type ResetTestApplicationSupportOptions = {
  homeDirectory?: string
  removeDirectory?: (targetDirectory: string) => void
}

export function resetTestApplicationSupport({
  homeDirectory = homedir(),
  removeDirectory = (targetDirectory) =>
    rmSync(targetDirectory, { recursive: true, force: true }),
}: ResetTestApplicationSupportOptions = {}): string {
  const applicationSupportDirectory = resolve(
    homeDirectory,
    "Library",
    "Application Support",
  )
  const targetDirectory = join(
    applicationSupportDirectory,
    testApplicationIdentifier,
  )

  assertSafeTestApplicationSupportTarget(
    applicationSupportDirectory,
    targetDirectory,
  )
  removeDirectory(targetDirectory)

  return targetDirectory
}
