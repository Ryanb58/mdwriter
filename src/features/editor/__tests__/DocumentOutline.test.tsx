import { useEffect, useRef } from "react"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { EditorState } from "@codemirror/state"
import { DocumentOutline, DocumentOutlineProvider, useDocumentOutline } from "../DocumentOutline"
import { useRawOutline } from "../useRawOutline"
import { useBlockOutline } from "../useBlockOutline"
import type { EditorView } from "@codemirror/view"

const markdown = "---\n# Hidden YAML\n---\n\n# Same\n\nbody\n\n### Same"
const secondOffset = markdown.indexOf("### Same")
afterEach(cleanup)

function Controls({ navigate }: { navigate: (index: number) => boolean }) {
  const outline = useDocumentOutline()!
  useEffect(() => {
    outline.navigate.current = navigate
    outline.setActive(1)
  }, [navigate, outline.navigate, outline.setActive])
  return <DocumentOutline />
}

async function openOutline() {
  fireEvent.click(screen.getByRole("button", { name: "Document outline" }))
  return screen.findByRole("button", { name: "Heading level 3: Same" })
}

describe("document outline UI", () => {
  it("shows canonical hierarchy/current section and delegates exact duplicate navigation", async () => {
    const navigate = vi.fn(() => true)
    render(<DocumentOutlineProvider text={markdown}><Controls navigate={navigate} /></DocumentOutlineProvider>)
    const second = await openOutline()
    expect(screen.queryByText("Hidden YAML")).not.toBeInTheDocument()
    expect(second).toHaveAttribute("aria-current", "location")
    expect(second).toHaveStyle({ paddingLeft: "26px" })
    fireEvent.click(second)
    expect(navigate).toHaveBeenCalledWith(1)
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument()
  })

  it("refreshes from canonical edits, handles empty documents, and restores focus on Escape", async () => {
    const navigate = vi.fn(() => true)
    const view = render(<DocumentOutlineProvider text={markdown}><Controls navigate={navigate} /></DocumentOutlineProvider>)
    await openOutline()
    view.rerender(<DocumentOutlineProvider text="# Renamed"><Controls navigate={navigate} /></DocumentOutlineProvider>)
    expect(await screen.findByRole("button", { name: "Heading level 1: Renamed" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Heading level 3: Same" })).not.toBeInTheDocument()
    fireEvent.keyDown(document, { key: "Escape" })
    expect(screen.getByRole("button", { name: "Document outline" })).toHaveFocus()
    view.rerender(<DocumentOutlineProvider text="No headings"><Controls navigate={navigate} /></DocumentOutlineProvider>)
    fireEvent.click(screen.getByRole("button", { name: "Document outline" }))
    expect(await screen.findByText(/No headings yet/)).toBeInTheDocument()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument()
  })

  it("keeps navigation open when the editor is still hydrating", async () => {
    render(<DocumentOutlineProvider text={markdown}><Controls navigate={() => false} /></DocumentOutlineProvider>)
    fireEvent.click(await openOutline())
    expect(screen.getByRole("navigation")).toBeInTheDocument()
  })
})

function RawHarness({ view }: { view: EditorView }) {
  const ref = useRef(view)
  const report = useRawOutline(ref)
  return <><DocumentOutline /><button onClick={() => report(true)}>Report edit</button></>
}

it("raw adapter navigates with a selection-only transaction, reports scroll and cursor, and cleans up", async () => {
  const scrollDOM = document.createElement("div")
  const doc = EditorState.create({ doc: markdown }).doc
  let head = 0
  let viewport = 0
  const dispatch = vi.fn()
  const focus = vi.fn()
  const view = {
    scrollDOM,
    contentDOM: document.createElement("div"),
    state: { doc, selection: { main: { get head() { return head } } } },
    hasFocus: false,
    posAtCoords: () => viewport,
    dispatch,
    focus,
  } as unknown as EditorView
  const rendered = render(<DocumentOutlineProvider text={markdown}><RawHarness view={view} /></DocumentOutlineProvider>)
  const second = await openOutline()
  viewport = secondOffset
  fireEvent.scroll(scrollDOM)
  await waitFor(() => expect(second).toHaveAttribute("aria-current", "location"))
  head = markdown.indexOf("# Same")
  fireEvent.click(screen.getByRole("button", { name: "Report edit" }))
  await waitFor(() => expect(screen.getByRole("button", { name: "Heading level 1: Same" })).toHaveAttribute("aria-current", "location"))
  fireEvent.click(second)
  expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ selection: { anchor: secondOffset } }))
  expect(dispatch.mock.calls[0][0]).not.toHaveProperty("changes")
  expect(focus).toHaveBeenCalledOnce()
  expect(doc.toString()).toBe(markdown)
  const remove = vi.spyOn(scrollDOM, "removeEventListener")
  rendered.unmount()
  expect(remove).toHaveBeenCalledWith("scroll", expect.any(Function))
})

it("block adapter uses BlockNote selection APIs and keeps active section in sync without replacing blocks", async () => {
  let onSelection: () => void = () => {}
  let cursor = "a"
  const unsubscribe = vi.fn()
  const editor = {
    document: [
      { id: "a", type: "heading", props: { level: 1 } },
      { id: "p", type: "paragraph" },
      { id: "b", type: "heading", props: { level: 3 } },
    ],
    isFocused: () => true,
    getTextCursorPosition: () => ({ block: { id: cursor } }),
    setTextCursorPosition: vi.fn(),
    focus: vi.fn(),
    onSelectionChange: (callback: () => void) => { onSelection = callback; return unsubscribe },
  }
  function BlockHarness() {
    const host = useRef<HTMLDivElement>(null)
    useBlockOutline(editor, host)
    return <><DocumentOutline /><div ref={host} data-testid="scroll-host"><div data-id="a" /><div data-id="p" /><div data-id="b" /></div></>
  }
  const rendered = render(<DocumentOutlineProvider text={markdown}><BlockHarness /></DocumentOutlineProvider>)
  const second = await openOutline()
  await waitFor(() => expect(screen.getByRole("button", { name: "Heading level 1: Same" })).toHaveAttribute("aria-current", "location"))
  cursor = "b"
  act(() => onSelection())
  await waitFor(() => expect(second).toHaveAttribute("aria-current", "location"))
  const host = screen.getByTestId("scroll-host")
  vi.spyOn(host.querySelector('[data-id="a"]')!, "getBoundingClientRect").mockReturnValue({ top: -100 } as DOMRect)
  vi.spyOn(host.querySelector('[data-id="b"]')!, "getBoundingClientRect").mockReturnValue({ top: 300 } as DOMRect)
  fireEvent.scroll(host)
  await waitFor(() => expect(second).not.toHaveAttribute("aria-current"))
  fireEvent.click(second)
  expect(editor.setTextCursorPosition).toHaveBeenCalledWith("b", "start")
  expect(editor.focus).toHaveBeenCalledOnce()
  expect(host.scrollTop).toBe(284)
  rendered.unmount()
  expect(unsubscribe).toHaveBeenCalled()
})
