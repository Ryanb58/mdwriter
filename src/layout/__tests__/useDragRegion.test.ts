import { renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const startDragging = vi.fn(() => Promise.resolve())
const toggleMaximize = vi.fn(() => Promise.resolve())

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ startDragging, toggleMaximize }),
}))

import { useDragRegion } from "../useDragRegion"

type StubEvent = {
  button?: number
  detail?: number
  target: EventTarget | null
  preventDefault: () => void
}

function makeEvent(over: HTMLElement, over_opts: Partial<StubEvent> = {}): StubEvent {
  return {
    button: 0,
    detail: 1,
    target: over,
    preventDefault: vi.fn(),
    ...over_opts,
  }
}

function el(html: string): HTMLElement {
  const host = document.createElement("div")
  host.innerHTML = html
  return host.firstElementChild as HTMLElement
}

describe("useDragRegion", () => {
  beforeEach(() => {
    startDragging.mockClear()
    toggleMaximize.mockClear()
  })
  afterEach(() => vi.restoreAllMocks())

  it("starts dragging on a left-button mousedown over a non-interactive target", () => {
    const { result } = renderHook(() => useDragRegion())
    const e = makeEvent(el("<div>title</div>"))
    result.current.onMouseDown(e as unknown as React.MouseEvent)
    expect(startDragging).toHaveBeenCalledTimes(1)
    expect(e.preventDefault).toHaveBeenCalled()
  })

  it("ignores non-left mouse buttons", () => {
    const { result } = renderHook(() => useDragRegion())
    result.current.onMouseDown(
      makeEvent(el("<div>title</div>"), { button: 2 }) as unknown as React.MouseEvent,
    )
    expect(startDragging).not.toHaveBeenCalled()
  })

  it("does not start a drag when the target is an interactive control", () => {
    const { result } = renderHook(() => useDragRegion())
    const btn = el('<button><span>x</span></button>').querySelector("span")!
    result.current.onMouseDown(
      makeEvent(btn as unknown as HTMLElement) as unknown as React.MouseEvent,
    )
    expect(startDragging).not.toHaveBeenCalled()
  })

  it("respects [data-no-drag] descendants", () => {
    const { result } = renderHook(() => useDragRegion())
    const target = el('<div data-no-drag><i>x</i></div>').querySelector("i")!
    result.current.onMouseDown(
      makeEvent(target as unknown as HTMLElement) as unknown as React.MouseEvent,
    )
    expect(startDragging).not.toHaveBeenCalled()
  })

  it("does not start a drag on the second click of a double-click (detail > 1)", () => {
    const { result } = renderHook(() => useDragRegion())
    result.current.onMouseDown(
      makeEvent(el("<div>title</div>"), { detail: 2 }) as unknown as React.MouseEvent,
    )
    expect(startDragging).not.toHaveBeenCalled()
  })

  it("toggles maximize on a double-click over a non-interactive target", () => {
    const { result } = renderHook(() => useDragRegion())
    const e = makeEvent(el("<div>title</div>"), { detail: 2 })
    result.current.onDoubleClick(e as unknown as React.MouseEvent)
    expect(toggleMaximize).toHaveBeenCalledTimes(1)
    expect(e.preventDefault).toHaveBeenCalled()
  })

  it("does not toggle maximize when double-clicking an interactive control", () => {
    const { result } = renderHook(() => useDragRegion())
    const btn = el("<button>x</button>")
    result.current.onDoubleClick(
      makeEvent(btn, { detail: 2 }) as unknown as React.MouseEvent,
    )
    expect(toggleMaximize).not.toHaveBeenCalled()
  })
})
