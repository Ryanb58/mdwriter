# Testing

mdwriter has three complementary test suites. Use the smallest suite that
covers the change, then run the broader checks before merging.

| Suite | Command | What it covers |
| --- | --- | --- |
| Vitest | `pnpm test` | Frontend unit and component behavior in jsdom. |
| Playwright | `pnpm test:e2e` | Browser-only layout smoke tests; it starts Vite and does not run Tauri. |
| WebdriverIO | `pnpm test:tauri` | A real macOS `.app`, including WKWebView, Tauri IPC, Rust commands, disk access, and emitted events. |

## Real Tauri integration tests

The WebdriverIO suite is macOS-only. It builds an isolated debug application
with the `tauri-integration-tests` Cargo feature, then launches that app with
the embedded Tauri driver.

```bash
pnpm test:tauri         # build the isolated app, then run all desktop specs
pnpm test:tauri:build   # build only; slow on the first run
pnpm test:tauri:run     # run specs against an already-built app
```

The initial `pnpm test:tauri` build compiles the Rust test dependencies and
can take a while. While iterating, run `pnpm test:tauri:build` after changing
the app and use `pnpm test:tauri:run` for repeated spec runs.

The test build has its own application identifier (`dev.mdwriter.editor.e2e`),
so its preferences and state are separate from a normal installation. Each
filesystem spec creates a uniquely named vault below the operating system
temporary directory. The helper verifies its safe prefix before deleting that
vault in `afterEach`; watcher specs also stop the Rust watcher before cleanup.

The test-only Cargo feature, WebdriverIO Rust plugins, guest code, and test
permissions are strictly for this debug test build. Never pass
`--features tauri-integration-tests` or `src-tauri/tauri.e2e.conf.json` to a
release build.

## Troubleshooting desktop tests

`pnpm test:tauri:run` expects the debug application at
`src-tauri/target/debug/bundle/macos/mdwriter.app`. If it is absent, run
`pnpm test:tauri:build` first.

WebdriverIO runs one desktop instance at a time and the embedded driver uses a
local loopback port. Its selected port, driver lifecycle, frontend output, and
backend output are recorded under `test-results/tauri/`, especially
`test-results/tauri/wdio.log`. The service owns the launched app and embedded
driver: it closes the WebDriver session and stops the driver at suite shutdown.
If a run is interrupted, inspect that directory first; it is also uploaded by
the macOS pull-request workflow when the suite fails.
