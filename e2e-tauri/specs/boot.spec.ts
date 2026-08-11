import { $, browser, expect } from "@wdio/globals"

describe("mdwriter desktop integration", () => {
  it("boots the real application with the Tauri test API", async () => {
    await expect($("#root > *")).toBeExisting()
    expect(
      await browser.tauri.execute(({ core }) => typeof core.invoke === "function"),
    ).toBe(true)
  })
})
