import { accessSync, constants } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "../..")

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
