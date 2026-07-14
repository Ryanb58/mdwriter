import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useStore } from "../../../lib/store"
import { FindBar } from "../FindBar"

function openFind() {
  fireEvent.keyDown(document, { key: "f", ctrlKey: true })
  return screen.getByRole("textbox", { name: "Find in note" }) as HTMLInputElement
}

function runDebounce() {
  act(() => vi.advanceTimersByTime(150))
}

describe("FindBar exact editor targets", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useStore.setState({
      rootPath: "/vault",
      openDoc: null,
      docRev: 0,
      editorMode: "raw",
      preferredEditorMode: "raw",
      pendingScroll: null,
      blockTextIndex: null,
    })
  })

  afterEach(() => {
    cleanup()
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it("builds raw source ranges while keeping focus in the Find input", () => {
    useStore.getState().openAnalyzedDocument(
      "/vault/raw.md",
      "one TWO two",
      "disk",
    )
    useStore.setState({ editorMode: "raw" })
    render(<FindBar />)

    const input = openFind()
    fireEvent.change(input, { target: { value: "two" } })
    runDebounce()

    expect(screen.getByText("1/2")).toBeInTheDocument()
    expect(useStore.getState().pendingScroll).toEqual({
      kind: "find-raw",
      path: "/vault/raw.md",
      from: 4,
      to: 7,
      requestId: expect.any(Number),
    })
    expect(input).toHaveFocus()

    const firstRequest = useStore.getState().pendingScroll
    const firstRequestId =
      firstRequest?.kind === "find-raw" || firstRequest?.kind === "find-block"
        ? firstRequest.requestId
        : -1
    fireEvent.keyDown(input, { key: "Enter" })
    expect(useStore.getState().pendingScroll).toEqual({
      kind: "find-raw",
      path: "/vault/raw.md",
      from: 8,
      to: 11,
      requestId: expect.any(Number),
    })
    const secondRequest = useStore.getState().pendingScroll
    expect(secondRequest?.kind).toBe("find-raw")
    expect(
      secondRequest?.kind === "find-raw" ? secondRequest.requestId : -1,
    ).toBeGreaterThan(firstRequestId)
    expect(input).toHaveFocus()
  })

  it("keeps the Find input focused when pointer navigation is clicked", () => {
    useStore.getState().openAnalyzedDocument(
      "/vault/raw.md",
      "one two two",
      "disk",
    )
    useStore.setState({ editorMode: "raw" })
    render(<FindBar />)
    const input = openFind()
    fireEvent.change(input, { target: { value: "two" } })
    runDebounce()

    const next = screen.getByRole("button", { name: "Next match" })
    const pointerDown = new MouseEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
    })
    next.dispatchEvent(pointerDown)
    // Model the browser's default pointer focus only when the handler allows it.
    if (!pointerDown.defaultPrevented) next.focus()
    fireEvent.click(next)

    expect(pointerDown.defaultPrevented).toBe(true)
    expect(input).toHaveFocus()
    expect(useStore.getState().pendingScroll).toMatchObject({
      kind: "find-raw",
      from: 8,
      to: 11,
    })
  })

  it("uses only the active rendered BlockNote index", () => {
    useStore.getState().openAnalyzedDocument(
      "/vault/block.md",
      "See [Visible label](hidden-destination) and [[Hidden target|Alias]].",
      "disk",
    )
    const state = useStore.getState()
    useStore.setState({ editorMode: "block" })
    state.setBlockTextIndex({
      path: "/vault/block.md",
      docKey: `/vault/block.md#${state.docRev}`,
      blocks: [{ blockId: "links", text: "See Visible label and Alias." }],
    })
    render(<FindBar />)

    const input = openFind()
    fireEvent.change(input, { target: { value: "hidden" } })
    runDebounce()
    expect(screen.getByText("0")).toBeInTheDocument()
    expect(useStore.getState().pendingScroll).toBeNull()

    fireEvent.change(input, { target: { value: "alias" } })
    runDebounce()
    expect(screen.getByText("1/1")).toBeInTheDocument()
    expect(useStore.getState().pendingScroll).toEqual({
      kind: "find-block",
      path: "/vault/block.md",
      blockId: "links",
      from: 22,
      to: 27,
      requestId: expect.any(Number),
    })
  })

  it("reissues an unchanged block target when the rendered layout updates", () => {
    useStore.getState().openAnalyzedDocument("/vault/block.md", "Match", "disk")
    useStore.setState({ editorMode: "block" })
    const { docRev, setBlockTextIndex } = useStore.getState()
    const index = {
      path: "/vault/block.md",
      docKey: `/vault/block.md#${docRev}`,
      blocks: [{ blockId: "match", text: "Match" }],
    }
    setBlockTextIndex(index)
    render(<FindBar />)
    const input = openFind()
    fireEvent.change(input, { target: { value: "match" } })
    runDebounce()
    const first = useStore.getState().pendingScroll
    expect(first?.kind).toBe("find-block")
    const firstRequest = first?.kind === "find-block" ? first.requestId : -1

    act(() => setBlockTextIndex({ ...index, blocks: [...index.blocks] }))

    const refreshed = useStore.getState().pendingScroll
    expect(refreshed).toMatchObject({
      kind: "find-block",
      blockId: "match",
      from: 0,
      to: 5,
    })
    expect(refreshed?.kind === "find-block" ? refreshed.requestId : -1)
      .toBeGreaterThan(firstRequest)
  })

  it("resets on note changes and clamps the active match after edits", () => {
    useStore.getState().openAnalyzedDocument("/vault/a.md", "hit hit hit", "disk")
    useStore.setState({ editorMode: "raw" })
    render(<FindBar />)
    const input = openFind()
    fireEvent.change(input, { target: { value: "hit" } })
    runDebounce()
    fireEvent.keyDown(input, { key: "Enter" })
    fireEvent.keyDown(input, { key: "Enter" })
    expect(screen.getByText("3/3")).toBeInTheDocument()

    act(() => useStore.getState().editOpenDoc("hit"))
    expect(screen.getByText("1/1")).toBeInTheDocument()
    expect(useStore.getState().pendingScroll).toMatchObject({
      kind: "find-raw",
      path: "/vault/a.md",
      from: 0,
      to: 3,
    })

    act(() => {
      useStore.getState().openAnalyzedDocument("/vault/b.md", "hit hit", "disk")
      useStore.setState({ editorMode: "raw" })
    })
    expect(screen.getByText("1/2")).toBeInTheDocument()
    runDebounce()
    expect(useStore.getState().pendingScroll).toMatchObject({
      kind: "find-raw",
      path: "/vault/b.md",
      from: 0,
      to: 3,
    })
  })

  it("clears an active highlight for an empty query and on close", () => {
    useStore.getState().openAnalyzedDocument("/vault/a.md", "find me", "disk")
    useStore.setState({ editorMode: "raw" })
    render(<FindBar />)
    const input = openFind()
    fireEvent.change(input, { target: { value: "find" } })
    runDebounce()
    expect(useStore.getState().pendingScroll?.kind).toBe("find-raw")

    fireEvent.change(input, { target: { value: "" } })
    expect(useStore.getState().pendingScroll).toBeNull()

    fireEvent.change(input, { target: { value: "find" } })
    runDebounce()
    fireEvent.click(screen.getByRole("button", { name: "Close find" }))
    expect(useStore.getState().pendingScroll).toBeNull()
    expect(screen.queryByRole("textbox", { name: "Find in note" })).toBeNull()
  })
})
