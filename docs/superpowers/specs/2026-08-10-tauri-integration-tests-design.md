# macOS Tauri Integration Tests

**Date:** 2026-08-10
**Status:** Approved approach; pending written-spec review

## 1. Purpose

mdwriter's Playwright tests run the Vite frontend in a normal browser. They
verify rendering, but they cannot exercise the desktop binary, WKWebView,
Tauri's IPC bridge, Rust command registration, filesystem scope, persisted
application data, native events, or the file watcher.

This initiative adds a separate macOS-only integration suite that launches a
real test build of mdwriter and drives it with WebdriverIO's embedded Tauri
provider. The first suite validates the desktop integration boundary rather
than duplicating frontend component tests.

## 2. Goals

- Launch the real macOS application binary and wait for React to mount inside
  WKWebView.
- Execute real Rust commands through Tauri's IPC bridge.
- Exercise filesystem commands against a fresh temporary vault and verify the
  resulting host filesystem bytes.
- Verify the active-vault scope rejects paths outside the selected vault.
- Verify recent-folder commands use an isolated test application-data domain.
- Verify an external host write reaches the frontend through the real watcher
  and Tauri event channel.
- Run the suite serially on macOS locally and in pull-request CI.
- Make it impossible for the WebDriver server or its permissions to enter a
  production build accidentally.

## 3. Non-goals

- Replacing the existing Vitest or Playwright suites.
- Automating the native macOS folder picker.
- Covering Windows or Linux in the first version.
- Testing every UI feature through the desktop driver.
- Testing AI subprocesses, updater installation, clipboard images, trash, or
  native menu interaction in the first version.
- Running tests in parallel against shared ports or application state.
- Adding test-only IPC commands to mdwriter.

## 4. Harness Architecture

### 4.1 WebDriver stack

Use WebdriverIO with `@wdio/tauri-service` and its embedded driver provider.
The service owns application launch, WebDriver connection, logs, and process
cleanup. The embedded provider avoids the unsupported native WKWebView driver
path and requires no separately installed `tauri-driver` intermediary.

The suite lives separately from browser E2E tests:

- `e2e-tauri/wdio.conf.ts` — serial runner and application launch settings.
- `e2e-tauri/specs/` — real-desktop integration specs.
- `e2e/` and `playwright.config.ts` — unchanged browser-only smoke coverage.

Package scripts remain explicit:

- `test:e2e` continues to run Playwright.
- `test:tauri` builds the test application and runs WebdriverIO.
- Separate build/run scripts allow iterating without rebuilding after every
  test-only spec change.

### 4.2 Test-only application build

Cargo defines an opt-in integration-test feature containing the WebdriverIO
Tauri plugin and embedded WebDriver plugin as optional dependencies. `run()`
registers those plugins only when that feature is enabled.

The frontend WebdriverIO guest plugin loads before React only in the test
build. The test build also enables the Tauri global required by the service.
Normal development and release builds do not import the guest plugin, register
either Rust plugin, expose WebDriver permissions, or start a WebDriver server.

The test build uses a checked-in Tauri configuration override with:

- a distinct identifier such as `dev.mdwriter.editor.e2e`;
- updater artifact generation disabled;
- an application bundle only, with no DMG;
- test-only WebdriverIO permissions;
- settings that suppress background updater checks during the suite.

The separate identifier isolates single-instance behavior and all application
support files from the user's installed or development copy of mdwriter.

### 4.3 Test data isolation

The Node test process creates a unique temporary vault for each filesystem
spec. It writes fixtures directly when simulating an external program and
uses real IPC commands when simulating mdwriter. Tests establish the active
vault through the real root-listing command before invoking scoped commands.

Every spec cleans up its temporary vault in `finally`/suite teardown. The test
runner also starts with a clean application-data directory belonging only to
the test identifier. Cleanup must resolve and validate the exact test path;
it must never target the production identifier, the repository, the user's
home directory, or a path derived from an unresolved environment variable.

The runner uses one application instance and one WebDriver port allocation.
Specs may be split by concern but cannot run concurrently.

## 5. Initial Test Coverage

### 5.1 Desktop boot

Launch the test application, confirm the WebdriverIO Tauri API is available,
and wait for a React-owned element under `#root`. This proves that the binary,
embedded driver, WKWebView, frontend bundle, and Tauri guest plugin agree.

### 5.2 Directory and file round-trip

Create a temporary vault containing a nested Markdown fixture, then:

1. invoke the real root-listing command and assert the shallow tree shape;
2. invoke the real directory-listing command and assert the nested fixture;
3. invoke create/write/read commands for another note;
4. verify the exact saved bytes from Node on the host filesystem.

This test crosses the full JavaScript → Tauri IPC → Rust command → filesystem
boundary without depending on the native folder picker.

### 5.3 Vault-scope enforcement

After establishing the temporary vault, create a second temporary directory
outside it. Attempt a read or write through real IPC and assert that:

- the command rejects with the serialized scope error;
- no outside file is created or changed.

### 5.4 Recent-folder isolation

Push the temporary vault through the real recent-folder command and read it
back. Assert it is first in the returned list and that the production app-data
domain is never touched. The test does not depend on or modify the user's real
recent folders.

### 5.5 Watcher event delivery

Establish the vault, start the real watcher, and subscribe to `vault-changed`
inside WKWebView. Write a Markdown file from Node, then wait until the frontend
receives an event containing its canonical path. Stop the watcher in teardown
even when the assertion fails.

The test waits on observable state with a bounded timeout. Fixed sleeps are
allowed only for driver startup internals owned by the service, not for
filesystem assertions.

## 6. Error Handling and Diagnostics

- Capture frontend and Rust logs through the WebdriverIO service.
- Retain a screenshot and runner logs when a spec fails in CI.
- Include command names and serialized errors in failed IPC assertions.
- Use bounded readiness and event timeouts with descriptive timeout messages.
- Ensure application and WebDriver processes terminate after failed setup or
  failed tests so a second run cannot inherit occupied ports.
- Treat inability to start the actual binary as a hard failure, never as a
  skipped test.

## 7. Continuous Integration

Add a dedicated GitHub Actions workflow for pull requests to `main` and manual
dispatch. It runs on `macos-15` with read-only repository permissions and:

1. checks out the commit;
2. installs the pinned pnpm, Node, and Rust toolchains;
3. restores dependency/build caches where safe;
4. installs dependencies from the lockfile;
5. builds the macOS test application with the opt-in test feature;
6. runs the serial WebdriverIO suite;
7. uploads failure artifacts.

Use workflow concurrency keyed by pull request/ref and cancel superseded runs.
The release workflow remains unchanged and never enables the test feature.

## 8. Production-Safety Verification

The implementation must prove both sides of the feature gate:

- the integration build exposes the embedded driver and passes the suite;
- the normal production build still succeeds without the integration feature;
- the normal frontend output contains no WebdriverIO guest-plugin chunk;
- the standard capability set contains no WebdriverIO permission;
- release scripts and Tauri release configuration never enable the feature.

These checks are covered by configuration/unit assertions where practical and
by running the normal production build before handoff.

## 9. Acceptance Criteria

- A single documented command runs the real macOS integration suite locally.
- No globally installed WebDriver or paid service is required.
- The five initial scenarios pass against a real mdwriter `.app`.
- Tests use only temporary vaults and the isolated test identifier.
- Pull requests receive a macOS integration-test check.
- Existing frontend and Rust suites remain green.
- Normal builds contain no integration-test server, permissions, or frontend
  guest code.
