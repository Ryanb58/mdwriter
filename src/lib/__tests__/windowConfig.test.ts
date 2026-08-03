import { describe, expect, it } from "vitest"
import tauriConfig from "../../../src-tauri/tauri.conf.json"

describe("main window configuration", () => {
  it("starts visible with a usable minimum size", () => {
    const mainWindow = tauriConfig.app.windows[0]

    expect(mainWindow).toMatchObject({
      visible: true,
      minWidth: 480,
      minHeight: 360,
    })
  })
})
