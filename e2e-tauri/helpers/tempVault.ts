import { mkdtempSync, realpathSync, rmSync } from "node:fs"
import { join, resolve } from "node:path"
import { tmpdir } from "node:os"

const vaultPrefix = "mdwriter-tauri-e2e-"
const temporaryDirectory = realpathSync(resolve(tmpdir()))
const safeVaultPrefix = join(temporaryDirectory, vaultPrefix)

export function createTempVault(): { root: string; cleanup(): void } {
  const root = realpathSync(mkdtempSync(safeVaultPrefix))

  return {
    root,
    cleanup() {
      if (!root.startsWith(safeVaultPrefix)) {
        throw new Error(`refusing to remove unexpected temporary vault: ${root}`)
      }

      rmSync(root, { recursive: true, force: true })
    },
  }
}
