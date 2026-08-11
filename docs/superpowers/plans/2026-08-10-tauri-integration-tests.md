# macOS Tauri Integration Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a macOS-only WebdriverIO suite that launches a real mdwriter application and verifies WKWebView, Tauri IPC, Rust filesystem scope, recent-folder persistence, and watcher events end to end.

**Architecture:** Build a separate app flavor with an isolated bundle identifier and optional WebdriverIO Rust plugins behind the `tauri-integration-tests` Cargo feature. WebdriverIO's official Tauri service launches that binary with its embedded provider, while serial specs create temporary vaults and call mdwriter's existing commands through `browser.tauri.execute`.

**Tech Stack:** Tauri 2, Rust optional Cargo features, Vite environment replacement, WebdriverIO 9, `@wdio/tauri-service`, Mocha, TypeScript, GitHub Actions `macos-15`.

## Global Constraints

- The first version runs on macOS only.
- Keep the existing Vitest and Playwright suites; `pnpm test:e2e` remains browser-only.
- Do not automate the native folder picker.
- Do not add test-only mdwriter IPC commands.
- Run real-Tauri specs serially with one application instance.
- Use fresh temporary vaults and the isolated identifier `dev.mdwriter.editor.e2e`.
- Never enable WebdriverIO Rust plugins, permissions, guest code, or the embedded server in production builds.
- Preserve the existing updater public key and release workflow.
- Do not modify or stage `.claude/` or `provn-all-blue.png`.

---

### Task 1: Production-safe Tauri test build flavor

**Files:**
- Create: `src-tauri/tauri.e2e.conf.json`
- Create: `src/lib/__tests__/tauriE2eConfig.test.ts`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Produces: Cargo feature `tauri-integration-tests`.
- Produces: a Tauri config override with identifier `dev.mdwriter.editor.e2e`, `app.withGlobalTauri: true`, and inline `wdio:default` / `wdio-webdriver:default` permissions.
- Consumes later: Task 3 builds with `--features tauri-integration-tests --config src-tauri/tauri.e2e.conf.json`.

- [ ] **Step 1: Add a failing configuration contract test**

```ts
import { describe, expect, it } from "vitest"
import productionConfig from "../../../src-tauri/tauri.conf.json"
import e2eConfig from "../../../src-tauri/tauri.e2e.conf.json"
import productionCapability from "../../../src-tauri/capabilities/default.json"

describe("Tauri integration-test build", () => {
  it("uses an isolated identity and test-only WebDriver permissions", () => {
    expect(e2eConfig.identifier).toBe("dev.mdwriter.editor.e2e")
    expect(e2eConfig.identifier).not.toBe(productionConfig.identifier)
    expect(e2eConfig.app.withGlobalTauri).toBe(true)
    const permissions = e2eConfig.app.security.capabilities[0].permissions
    expect(permissions).toContain("wdio:default")
    expect(permissions).toContain("wdio-webdriver:default")
    expect(productionCapability.permissions).not.toContain("wdio:default")
    expect(productionCapability.permissions).not.toContain("wdio-webdriver:default")
    expect(e2eConfig.bundle.createUpdaterArtifacts).toBe(false)
  })
})
```

- [ ] **Step 2: Run the contract test and observe RED**

Run: `pnpm exec vitest run src/lib/__tests__/tauriE2eConfig.test.ts`

Expected: FAIL because `src-tauri/tauri.e2e.conf.json` does not exist.

- [ ] **Step 3: Add the test configuration override**

Create a JSON override with the isolated identifier, `withGlobalTauri`, app-only bundling, updater artifacts disabled, and an inline capability that repeats every production permission plus:

```json
{
  "identifier": "dev.mdwriter.editor.e2e",
  "app": {
    "withGlobalTauri": true,
    "security": {
      "capabilities": [{
        "identifier": "e2e-main",
        "windows": ["main"],
        "permissions": [
          "core:default",
          "core:window:allow-start-dragging",
          "core:window:allow-toggle-maximize",
          "core:window:allow-show",
          "core:window:allow-hide",
          "core:window:allow-set-focus",
          "core:window:allow-destroy",
          "opener:default",
          "dialog:allow-open",
          "updater:allow-check",
          "updater:allow-download-and-install",
          "process:allow-restart",
          "clipboard-manager:allow-read-image",
          "clipboard-manager:allow-read-text",
          "window-state:default",
          "wdio:default",
          "wdio-webdriver:default"
        ]
      }]
    }
  },
  "bundle": {
    "targets": ["app"],
    "createUpdaterArtifacts": false
  }
}
```

- [ ] **Step 4: Add optional Rust plugins and feature-gated registration**

Add optional dependencies and the feature:

```toml
tauri-plugin-wdio = { version = "1", optional = true }
tauri-plugin-wdio-webdriver = { version = "1", optional = true }

[features]
tauri-integration-tests = [
  "dep:tauri-plugin-wdio",
  "dep:tauri-plugin-wdio-webdriver",
]
```

Immediately after `let builder = tauri::Builder::default();` in `run()`:

```rust
#[cfg(feature = "tauri-integration-tests")]
let builder = builder
    .plugin(tauri_plugin_wdio::init())
    .plugin(tauri_plugin_wdio_webdriver::init());
```

Run `cargo check --manifest-path src-tauri/Cargo.toml --features tauri-integration-tests` to update the lockfile and prove the feature compiles.

- [ ] **Step 5: Run the contract and Rust tests**

Run:

```bash
pnpm exec vitest run src/lib/__tests__/tauriE2eConfig.test.ts
cargo test --manifest-path src-tauri/Cargo.toml --lib
cargo check --manifest-path src-tauri/Cargo.toml --features tauri-integration-tests
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit the build flavor**

```bash
git add src-tauri/tauri.e2e.conf.json src/lib/__tests__/tauriE2eConfig.test.ts src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/lib.rs
git commit -m "test: add isolated Tauri integration build"
```

### Task 2: Test-only frontend guest bootstrap

**Files:**
- Create: `src/lib/tauriIntegrationMode.ts`
- Create: `src/lib/__tests__/tauriIntegrationMode.test.ts`
- Modify: `src/main.tsx`
- Modify: `src/vite-env.d.ts`
- Modify: `src/features/updates/useUpdates.ts`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Produces: `TAURI_INTEGRATION_TEST` boolean and
  `shouldScheduleSilentUpdateCheck(integrationTest: boolean): boolean`.
- Produces: `loadTauriIntegrationGuest(enabled, loader?) => Promise<void>`.
- Consumes later: test builds set `VITE_TAURI_INTEGRATION_TEST=1`; normal builds leave it unset.

- [ ] **Step 1: Write failing loader tests**

```ts
import { describe, expect, it, vi } from "vitest"
import {
  loadTauriIntegrationGuest,
  shouldScheduleSilentUpdateCheck,
} from "../tauriIntegrationMode"

describe("loadTauriIntegrationGuest", () => {
  it("loads the guest only for an integration build", async () => {
    const loader = vi.fn(async () => ({}))
    await loadTauriIntegrationGuest(true, loader)
    expect(loader).toHaveBeenCalledTimes(1)
  })

  it("leaves normal builds untouched", async () => {
    const loader = vi.fn(async () => ({}))
    await loadTauriIntegrationGuest(false, loader)
    expect(loader).not.toHaveBeenCalled()
  })

  it("disables only the automatic update check in integration builds", () => {
    expect(shouldScheduleSilentUpdateCheck(true)).toBe(false)
    expect(shouldScheduleSilentUpdateCheck(false)).toBe(true)
  })
})
```

- [ ] **Step 2: Run the loader tests and observe RED**

Run: `pnpm exec vitest run src/lib/__tests__/tauriIntegrationMode.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Install and implement the guest bootstrap**

Install `@wdio/tauri-plugin` as a development dependency. Implement:

```ts
export const TAURI_INTEGRATION_TEST =
  import.meta.env.VITE_TAURI_INTEGRATION_TEST === "1"

type GuestLoader = () => Promise<unknown>

export async function loadTauriIntegrationGuest(
  enabled: boolean,
  loader: GuestLoader = () => import("@wdio/tauri-plugin"),
): Promise<void> {
  if (enabled) await loader()
}

export function shouldScheduleSilentUpdateCheck(
  integrationTest: boolean,
): boolean {
  return !integrationTest
}
```

Declare `VITE_TAURI_INTEGRATION_TEST?: string` in `src/vite-env.d.ts`.

- [ ] **Step 4: Load the guest before React and suppress the update timer**

Wrap the existing React render in `bootstrap()`:

```ts
async function bootstrap() {
  await loadTauriIntegrationGuest(TAURI_INTEGRATION_TEST)
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode><App /></React.StrictMode>,
  )
}

void bootstrap()
```

In `useUpdates`, call `shouldScheduleSilentUpdateCheck(TAURI_INTEGRATION_TEST)`
before scheduling the silent timer. Keep manual update behavior unchanged.

- [ ] **Step 5: Verify test and production frontend builds**

Run:

```bash
pnpm exec vitest run src/lib/__tests__/tauriIntegrationMode.test.ts
pnpm build
VITE_TAURI_INTEGRATION_TEST=1 pnpm build
```

Expected: tests and both builds pass. Record the ordinary build asset list and
confirm it contains no asset whose name includes `wdio` or `tauri-plugin`.

- [ ] **Step 6: Commit the guest bootstrap**

```bash
git add src/lib/tauriIntegrationMode.ts src/lib/__tests__/tauriIntegrationMode.test.ts src/main.tsx src/vite-env.d.ts src/features/updates/useUpdates.ts package.json pnpm-lock.yaml
git commit -m "test: gate the Tauri test guest"
```

### Task 3: WebdriverIO harness and real-app boot test

**Files:**
- Create: `e2e-tauri/wdio.conf.ts`
- Create: `e2e-tauri/wdio.d.ts`
- Create: `e2e-tauri/helpers/paths.ts`
- Create: `e2e-tauri/helpers/ipc.ts`
- Create: `e2e-tauri/specs/boot.spec.ts`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `pnpm-workspace.yaml`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `appBinaryPath` resolving `src-tauri/target/debug/bundle/macos/mdwriter.app/Contents/MacOS/mdwriter`.
- Produces: `invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>`.
- Produces scripts: `test:tauri:build`, `test:tauri:run`, and `test:tauri`.
- Consumes: Task 1 Cargo feature/config and Task 2 frontend test flag.

- [ ] **Step 1: Add the WebdriverIO dependencies and scripts**

Replace the placeholder build policy in `pnpm-workspace.yaml` with the explicit
dependency build permission required by Vite:

```yaml
allowBuilds:
  esbuild: true
```

Install matching WebdriverIO 9 packages:

```bash
pnpm add -D @wdio/cli@^9 @wdio/globals@^9 @wdio/local-runner@^9 @wdio/mocha-framework@^9 @wdio/spec-reporter@^9 @wdio/tauri-service@^1 @wdio/types@^9 webdriverio@^9
```

Add scripts:

```json
"test:tauri:build": "VITE_TAURI_INTEGRATION_TEST=1 pnpm tauri build --debug --features tauri-integration-tests --bundles app --config src-tauri/tauri.e2e.conf.json",
"test:tauri:run": "wdio run ./e2e-tauri/wdio.conf.ts",
"test:tauri": "pnpm test:tauri:build && pnpm test:tauri:run"
```

- [ ] **Step 2: Write the boot spec before the harness exists**

```ts
import { $, browser, expect } from "@wdio/globals"

describe("mdwriter desktop integration", () => {
  it("boots the real application with the Tauri test API", async () => {
    await expect($("#root > *")).toBeExisting()
    expect(await browser.tauri.isTauriApiAvailable()).toBe(true)
  })
})
```

- [ ] **Step 3: Run the spec and observe RED**

Run: `pnpm test:tauri:run`

Expected: FAIL because the WebdriverIO config/binary does not exist yet.

- [ ] **Step 4: Implement paths, config, types, and IPC helper**

`paths.ts` resolves the repository root from `import.meta.url`, exports the
binary path, and throws from `assertAppBinaryExists()` with the exact build
command when missing.

`wdio.conf.ts` uses:

```ts
export const config: WebdriverIO.Config = {
  runner: "local",
  specs: ["./specs/**/*.spec.ts"],
  maxInstances: 1,
  capabilities: [{
    browserName: "tauri",
    "wdio:enforceWebDriverClassic": true,
    "tauri:options": { application: appBinaryPath },
    "wdio:tauriServiceOptions": {
      appBinaryPath,
      appArgs: [],
      driverProvider: "embedded",
      captureBackendLogs: true,
      captureFrontendLogs: true,
      backendLogLevel: "info",
      frontendLogLevel: "info",
    },
  }],
  services: [["@wdio/tauri-service", { driverProvider: "embedded" }]],
  framework: "mocha",
  reporters: ["spec"],
  logLevel: "info",
  waitforTimeout: 15_000,
  connectionRetryTimeout: 120_000,
  connectionRetryCount: 1,
  outputDir: "test-results/tauri",
  mochaOpts: { ui: "bdd", timeout: 60_000 },
  onPrepare: assertAppBinaryExists,
}
```

`ipc.ts` implements the real command helper:

```ts
export async function invoke<T>(
  command: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  return browser.tauri.execute(
    ({ core }, name, payload) => core.invoke<T>(name, payload),
    command,
    args,
  )
}
```

Add `test-results/tauri/` to the existing Playwright artifact ignore section.

- [ ] **Step 5: Build and run the boot spec**

Run: `pnpm test:tauri`

Expected: the app bundle builds and the boot spec passes against WKWebView.

- [ ] **Step 6: Commit the harness**

```bash
git add e2e-tauri package.json pnpm-lock.yaml pnpm-workspace.yaml .gitignore
git commit -m "test: launch the real macOS app"
```

### Task 4: Real IPC, scope, recents, and watcher scenarios

**Files:**
- Create: `e2e-tauri/helpers/tempVault.ts`
- Create: `e2e-tauri/specs/filesystem.spec.ts`
- Create: `e2e-tauri/specs/watcher.spec.ts`
- Modify: `e2e-tauri/wdio.d.ts`

**Interfaces:**
- Produces: `createTempVault(): { root: string; cleanup(): void }` using `mkdtempSync` under `tmpdir()`.
- Consumes: Task 3 `invoke<T>()`.
- Uses existing commands only: `list_tree`, `list_directory`, `create_file`, `write_file`, `read_file`, `push_recent_folder`, `get_recent_folders`, `start_watcher`, and `stop_watcher`.

- [ ] **Step 1: Write the filesystem and scope specs**

The filesystem spec must:

```ts
const vault = createTempVault()
const outside = createTempVault()

await invoke("list_tree", { root: vault.root, options: {} })
const tree = await invoke<TreeNode>("list_directory", {
  path: join(vault.root, "notes"),
  options: {},
})
expect(tree).toMatchObject({ kind: "dir", loaded: true })

const note = join(vault.root, "created.md")
await invoke("create_file", { path: note })
await invoke("write_file", { path: note, text: "# Written through IPC\n" })
expect(await invoke("read_file", { path: note })).toBe("# Written through IPC\n")
expect(readFileSync(note, "utf8")).toBe("# Written through IPC\n")

const forbidden = join(outside.root, "forbidden.md")
await expect(invoke("write_file", { path: forbidden, text: "no" }))
  .rejects.toMatchObject({ kind: "InvalidPath" })
expect(existsSync(forbidden)).toBe(false)
```

It must also push/read the vault through real recent-folder commands and assert
that the unique vault is first.

- [ ] **Step 2: Run the filesystem spec and observe RED**

Run: `pnpm test:tauri:run -- --spec e2e-tauri/specs/filesystem.spec.ts`

Expected: FAIL because the temporary-vault helper and/or exact wire assertions
are not implemented.

- [ ] **Step 3: Implement the temporary-vault helper and make filesystem green**

`cleanup()` calls `rmSync(root, { recursive: true, force: true })` only after
asserting that `root` starts with the resolved `tmpdir()` plus the fixed
`mdwriter-tauri-e2e-` prefix. Every spec calls cleanup in `afterEach` or
`finally`, including the outside directory.

Run the focused spec until it passes without weakening scope assertions.

- [ ] **Step 4: Write the watcher spec**

The watcher spec establishes a real listener in WKWebView, writes from Node,
and polls observable event payloads:

```ts
await invoke("list_tree", { root: vault.root, options: {} })
await invoke("start_watcher", { root: vault.root })
await browser.tauri.execute(async ({ event }) => {
  window.__mdwriterVaultChanges = []
  window.__mdwriterStopVaultListener = await event.listen<{ paths: string[] }>(
    "vault-changed",
    ({ payload }) => window.__mdwriterVaultChanges?.push(...payload.paths),
  )
})

writeFileSync(changedPath, "external edit")
await browser.waitUntil(
  () => browser.execute(
    (path) => window.__mdwriterVaultChanges?.includes(path) ?? false,
    changedPath,
  ),
  { timeout: 10_000, timeoutMsg: `watcher did not emit ${changedPath}` },
)
```

Teardown invokes the stored unlisten callback inside WKWebView, invokes
`stop_watcher`, and deletes the vault even when the assertion fails.

- [ ] **Step 5: Run all desktop integration specs**

Run: `pnpm test:tauri:run`

Expected: boot, filesystem/scope/recents, and watcher specs all pass serially.

- [ ] **Step 6: Commit real integration coverage**

```bash
git add e2e-tauri/helpers/tempVault.ts e2e-tauri/specs/filesystem.spec.ts e2e-tauri/specs/watcher.spec.ts e2e-tauri/wdio.d.ts
git commit -m "test: cover real Tauri filesystem integration"
```

### Task 5: macOS pull-request CI and documentation

**Files:**
- Create: `.github/workflows/tauri-integration.yml`
- Create: `docs/TESTING.md`
- Modify: `AGENTS.md`

**Interfaces:**
- Produces: GitHub check `Tauri integration (macOS)` on pull requests to `main`.
- Documents: `pnpm test:tauri`, `pnpm test:tauri:build`, and `pnpm test:tauri:run`.

- [ ] **Step 1: Add the macOS workflow**

```yaml
name: Tauri integration

on:
  pull_request:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: tauri-integration-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true

jobs:
  macos:
    name: Tauri integration (macOS)
    runs-on: macos-15
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 10
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - uses: dtolnay/rust-toolchain@stable
      - uses: actions/cache@v4
        with:
          path: |
            ~/.cargo/registry
            ~/.cargo/git
            src-tauri/target
          key: macos-tauri-e2e-${{ hashFiles('src-tauri/Cargo.lock') }}
      - run: pnpm install --frozen-lockfile
      - run: pnpm test:tauri
      - if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: tauri-integration-failure
          path: test-results/tauri
          if-no-files-found: ignore
```

- [ ] **Step 2: Document suite boundaries and troubleshooting**

`docs/TESTING.md` must explain:

- Vitest = frontend unit/component tests.
- Playwright = browser-only layout smoke tests.
- WebdriverIO = actual macOS `.app`, WKWebView, Tauri IPC, Rust, disk, events.
- The first `pnpm test:tauri` build is slow; use build/run scripts while
  iterating.
- Temporary vault and isolated identifier guarantees.
- Port/process/log locations and how the service cleans them up.
- The test feature must never be passed to release builds.

Add the three commands to AGENTS.md's command block and update its E2E scope
section without changing unrelated architecture guidance.

- [ ] **Step 3: Run complete verification**

Run fresh from the final tree:

```bash
pnpm test
pnpm build
pnpm test:e2e
cargo test --manifest-path src-tauri/Cargo.toml --lib
cargo check --manifest-path src-tauri/Cargo.toml --features tauri-integration-tests
pnpm test:tauri
git diff --check
```

Expected:

- 781 or more frontend tests pass.
- 125 or more Rust tests pass.
- production build and two browser E2E tests pass.
- all real-Tauri specs pass against the macOS app.
- no tracked output or unrelated user file appears in `git status`.

- [ ] **Step 4: Verify production exclusion explicitly**

Run `pnpm build`, list `dist/assets`, and assert no filename contains `wdio` or
`tauri-plugin`. Run `cargo tree --manifest-path src-tauri/Cargo.toml -e normal`
without the feature and assert neither `tauri-plugin-wdio` nor
`tauri-plugin-wdio-webdriver` appears.

- [ ] **Step 5: Commit CI and documentation**

```bash
git add .github/workflows/tauri-integration.yml docs/TESTING.md AGENTS.md
git commit -m "ci: run real Tauri tests on macOS"
```

- [ ] **Step 6: Review, push, and open the pull request**

Review the complete diff against the design, push
`tbrazelton/tauri-integration-tests`, and create a ready PR targeting `main`.
The PR body must separate browser E2E from real-Tauri coverage, list the five
desktop scenarios, explain production feature-gating, and include every
verification command that passed.
