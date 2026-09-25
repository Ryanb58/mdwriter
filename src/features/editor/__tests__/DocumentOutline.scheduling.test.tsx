import { StrictMode, useEffect } from "react"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  DocumentOutline,
  DocumentOutlineProvider,
  OUTLINE_DEBOUNCE_MS,
  useDocumentOutline,
} from "../DocumentOutline"
import { parseOutline } from "../documentOutline"

vi.mock("../documentOutline", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../documentOutline")>()
  return { ...actual, parseOutline: vi.fn(actual.parseOutline) }
})

const parse = vi.mocked(parseOutline)
const navigate = vi.fn(() => true)

function Controls() {
  const outline = useDocumentOutline()!
  useEffect(() => {
    outline.navigate.current = navigate
  }, [outline.navigate])
  return <DocumentOutline />
}

function view(text: string, docKey = "note") {
  return (
    <StrictMode>
      <DocumentOutlineProvider key={docKey} text={text}><Controls /></DocumentOutlineProvider>
    </StrictMode>
  )
}

const toggle = () => fireEvent.click(screen.getByRole("button", { name: "Document outline" }))
const heading = (title: string) => screen.getByRole("button", { name: `Heading level 1: ${title}` })
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
    await vi.dynamicImportSettled()
  })
}

describe("outline parsing schedule", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    parse.mockClear()
    navigate.mockClear()
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it("does no parsing while closed, then parses only the latest text on opening", async () => {
    const rendered = render(view("# Initial"))
    await advance(1000)
    for (const text of ["# Edit one", "# Edit two", "# Latest"]) {
      rendered.rerender(view(text))
      await advance(1000)
    }
    expect(parse).not.toHaveBeenCalled()

    toggle()
    expect(screen.getByText("Loading outline…")).toBeInTheDocument()
    expect(parse).not.toHaveBeenCalled()
    await advance(0)
    expect(parse).toHaveBeenCalledExactlyOnceWith("# Latest")
    expect(heading("Latest")).toBeEnabled()
    expect(screen.getByRole("navigation")).toHaveAttribute("aria-busy", "false")

    toggle()
    toggle()
    await advance(1000)
    expect(parse).toHaveBeenCalledTimes(1) // Reopening an unchanged document reuses its outline.
  })

  it("debounces open edits, retaining but disabling old headings until the latest parse", async () => {
    const rendered = render(view("# Original"))
    toggle()
    await advance(0)
    for (const text of ["# First edit", "# Second edit", "# Final edit"]) {
      rendered.rerender(view(text))
      expect(heading("Original")).toBeDisabled()
      fireEvent.click(heading("Original"))
      await advance(50)
    }
    expect(parse).toHaveBeenCalledTimes(1)
    expect(navigate).not.toHaveBeenCalled()
    expect(screen.queryByText(/No headings yet/)).not.toBeInTheDocument()
    expect(screen.getByRole("navigation")).toHaveAttribute("aria-busy", "true")
    await advance(OUTLINE_DEBOUNCE_MS - 50)
    expect(parse).toHaveBeenCalledTimes(2)
    expect(parse).toHaveBeenLastCalledWith("# Final edit")
    expect(screen.queryByRole("button", { name: "Heading level 1: Original" })).not.toBeInTheDocument()
    expect(heading("Final edit")).toBeEnabled()
    fireEvent.click(heading("Final edit"))
    expect(navigate).toHaveBeenCalledWith(0)
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument()
  })

  it("cancels pending work when closed and refreshes immediately on reopening", async () => {
    const rendered = render(view("# Before"))
    toggle()
    await advance(0)
    rendered.rerender(view("# Pending edit"))
    await advance(50)
    toggle()
    rendered.rerender(view("# Edited while closed"))
    await advance(1000)
    expect(parse).toHaveBeenCalledExactlyOnceWith("# Before")

    toggle()
    expect(heading("Before")).toBeDisabled()
    await advance(0)
    expect(parse).toHaveBeenCalledTimes(2)
    expect(parse).toHaveBeenLastCalledWith("# Edited while closed")
    expect(heading("Edited while closed")).toBeEnabled()
  })

  it("does not parse if dismissed before its first scheduled task", async () => {
    render(view("# Never parsed"))
    toggle()
    toggle()
    await advance(1000)
    expect(parse).not.toHaveBeenCalled()
  })

  it("cancels pending work on document replacement and unmount", async () => {
    const rendered = render(view("# First note"))
    toggle()
    await advance(0)
    rendered.rerender(view("# Stale edit"))
    rendered.rerender(view("# Other note", "other"))
    await advance(1000)
    expect(parse).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument()
    toggle()
    await advance(0)
    expect(heading("Other note")).toBeEnabled()
    expect(screen.queryByRole("button", { name: "Heading level 1: First note" })).not.toBeInTheDocument()
    rendered.rerender(view("# Abandoned edit", "other"))
    rendered.unmount()
    await advance(1000)
    expect(parse).toHaveBeenCalledTimes(2)
  })
})
