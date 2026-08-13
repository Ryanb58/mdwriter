import { act, renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"
import { windowScopedKey } from "../../lib/persistStorage"
import { PERSIST_WINDOW_LABEL } from "../../lib/windowEvents"
import { LAYOUT_PANELS_KEY, LAYOUT_WIDTHS_KEY, layoutStorageKey } from "../panelStorage"
import { usePanelStates } from "../usePanelStates"
import { usePanelWidths } from "../usePanelWidths"
import { PANEL_DIMS } from "../constants"

/**
 * Panel widths and panel collapse state are per-window chrome, exactly like the
 * store's `rightPaneTab`. Every window is a webview on one origin sharing one
 * `localStorage`, and these hooks read their entry only at mount — so an
 * unqualified key means window B's drag silently resizes window A on the next
 * launch, with nothing to notice it happened.
 */
describe("layout chrome is scoped to the window that owns it", () => {
  const otherWidths = windowScopedKey("w-other", LAYOUT_WIDTHS_KEY)
  const otherPanels = windowScopedKey("w-other", LAYOUT_PANELS_KEY)

  beforeEach(() => {
    localStorage.clear()
  })

  it("saves a width under this window's label and leaves the other window's alone", () => {
    localStorage.setItem(otherWidths, JSON.stringify({ left: 300, right: 320 }))

    const { result } = renderHook(() => usePanelWidths())
    act(() => result.current.setLeftWidth(420))

    expect(JSON.parse(localStorage.getItem(layoutStorageKey(LAYOUT_WIDTHS_KEY)) as string)).toMatchObject({
      left: 420,
    })
    expect(JSON.parse(localStorage.getItem(otherWidths) as string)).toMatchObject({ left: 300 })
    // And nothing lands on the unqualified key every window would share.
    expect(localStorage.getItem(`mdwriter:${LAYOUT_WIDTHS_KEY}`)).toBeNull()
  })

  it("does not adopt another window's width", () => {
    localStorage.setItem(otherWidths, JSON.stringify({ left: 300, right: 500 }))

    const { result } = renderHook(() => usePanelWidths())

    expect(result.current.leftWidth).toBe(PANEL_DIMS.LEFT_DEFAULT)
    expect(result.current.rightWidth).toBe(PANEL_DIMS.RIGHT_DEFAULT)
  })

  it("saves a collapsed panel under this window's label and ignores the other window's", () => {
    localStorage.setItem(
      otherPanels,
      JSON.stringify({ docked: { left: "rail", right: "rail" }, overlay: {} }),
    )

    const { result } = renderHook(() => usePanelStates("docked-wide"))
    expect(result.current.leftState).toBe("open")

    act(() => result.current.togglePanel("left"))

    expect(result.current.leftState).toBe("rail")
    expect(
      JSON.parse(localStorage.getItem(layoutStorageKey(LAYOUT_PANELS_KEY)) as string).docked.left,
    ).toBe("rail")
    expect(JSON.parse(localStorage.getItem(otherPanels) as string).docked).toEqual({
      left: "rail",
      right: "rail",
    })
  })

  it("inherits the pre-scoping entry, then supersedes it with its own", () => {
    // Upgrading must not throw away the layout the user already had.
    localStorage.setItem(`mdwriter:${LAYOUT_WIDTHS_KEY}`, JSON.stringify({ left: 360, right: 300 }))

    const { result } = renderHook(() => usePanelWidths())

    expect(result.current.leftWidth).toBe(360)
    expect(JSON.parse(localStorage.getItem(layoutStorageKey(LAYOUT_WIDTHS_KEY)) as string)).toEqual({
      left: 360,
      right: 300,
    })
  })

  it("namespaces under the running window's label", () => {
    expect(layoutStorageKey(LAYOUT_WIDTHS_KEY)).toBe(
      windowScopedKey(PERSIST_WINDOW_LABEL, LAYOUT_WIDTHS_KEY),
    )
  })
})
