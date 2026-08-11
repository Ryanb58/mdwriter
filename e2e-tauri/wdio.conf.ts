import { assertAppBinaryExists, appBinaryPath } from "./helpers/paths"

export const config: WebdriverIO.Config = {
  runner: "local",
  specs: ["./specs/**/*.spec.ts"],
  maxInstances: 1,
  capabilities: [
    {
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
    },
  ],
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
