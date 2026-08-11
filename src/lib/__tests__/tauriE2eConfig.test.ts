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
