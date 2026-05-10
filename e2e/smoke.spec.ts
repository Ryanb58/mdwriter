import { test, expect } from "@playwright/test"

test("loads empty state when no recent folder", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByText("Welcome to mdwriter")).toBeVisible()
})
