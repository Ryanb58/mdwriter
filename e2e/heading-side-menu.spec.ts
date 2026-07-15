import { expect, test } from "@playwright/test"

test("aligns heading side menus with their first text line", async ({ page }) => {
  await page.goto("/")

  await page.evaluate(async () => {
    await import("/src/features/editor/BlockEditor.tsx")

    document.body.innerHTML = `
      <div class="bn-root bn-container bn-mantine bn-default-styles">
        <div class="bn-editor">
          <div class="bn-block-outer">
            <div class="bn-block">
              <div class="bn-block-content" data-content-type="heading" data-testid="heading-content-1">
                <h1>Heading 1</h1>
              </div>
            </div>
          </div>
          <div class="bn-block-outer">
            <div class="bn-block">
              <div class="bn-block-content" data-content-type="heading" data-level="2">
                <h2>Heading 2</h2>
              </div>
            </div>
          </div>
          <div class="bn-block-outer">
            <div class="bn-block">
              <div class="bn-block-content" data-content-type="heading" data-level="3">
                <h3>Heading 3</h3>
              </div>
            </div>
          </div>
        </div>

        <div class="bn-side-menu" data-block-type="heading" data-level="1"></div>
        <div class="bn-side-menu" data-block-type="heading" data-level="2"></div>
        <div class="bn-side-menu" data-block-type="heading" data-level="3"></div>
        <div class="bn-side-menu" data-block-type="paragraph"></div>
        <div class="bn-side-menu" data-block-type="bulletListItem"></div>
      </div>
    `
  })

  const metrics = await page.evaluate(() => {
    return ["1", "2", "3"].map((level) => {
      const content = document.querySelector<HTMLElement>(
        level === "1"
          ? '[data-testid="heading-content-1"]'
          : `.bn-block-content[data-content-type="heading"][data-level="${level}"]`,
      )!
      const menu = document.querySelector<HTMLElement>(
        `.bn-side-menu[data-block-type="heading"][data-level="${level}"]`,
      )!
      const heading = content.querySelector<HTMLElement>(`h${level}`)!
      const contentRect = content.getBoundingClientRect()
      const headingRect = heading.getBoundingClientRect()
      const menuStyles = getComputedStyle(menu)

      return {
        level,
        menuCenter: parseFloat(menuStyles.height) / 2,
        firstLineCenter:
          headingRect.top - contentRect.top + headingRect.height / 2,
      }
    })
  })

  for (const metric of metrics) {
    expect(metric.menuCenter, `heading ${metric.level}`).toBeCloseTo(
      metric.firstLineCenter,
      1,
    )
  }

  for (const blockType of ["paragraph", "bulletListItem"]) {
    const menu = page.locator(
      `.bn-side-menu[data-block-type="${blockType}"]`,
    )
    await expect(menu).toHaveCSS("height", "30px")
    await expect(menu).toHaveCSS("margin-top", "0px")
  }
})
