import { describe, expect, it } from "vitest"
import {
  PILL_CLASS,
  SKILL_PILL_CLASS,
  insertLineBreakAtCaret,
  insertTextAtCaret,
  makeSkillPill,
  readEditorState,
  renderTextToEditor,
  setCaretAtTextOffset,
} from "../composerDOM"

function mount(): HTMLDivElement {
  const div = document.createElement("div")
  div.contentEditable = "true"
  document.body.appendChild(div)
  return div
}

function cleanup(div: HTMLDivElement) {
  div.remove()
}

describe("renderTextToEditor", () => {
  it("renders plain text into a single text node", () => {
    const div = mount()
    renderTextToEditor(div, "hello world")
    expect(div.childNodes.length).toBe(1)
    expect(div.textContent).toBe("hello world")
    cleanup(div)
  })

  it("turns `[[Name]]` runs into pill spans", () => {
    const div = mount()
    renderTextToEditor(div, "see [[Alpha]] and [[Beta Bar]] today")
    const pills = div.querySelectorAll(`.${PILL_CLASS}`)
    expect(pills).toHaveLength(2)
    expect(pills[0].getAttribute("data-target")).toBe("Alpha")
    expect(pills[1].getAttribute("data-target")).toBe("Beta Bar")
    // jsdom doesn't implement `isContentEditable`; check the attribute directly.
    expect(pills[0].getAttribute("contenteditable")).toBe("false")
    cleanup(div)
  })

  it("preserves embedded newlines as <br>", () => {
    const div = mount()
    renderTextToEditor(div, "line one\nline two")
    expect(div.querySelectorAll("br")).toHaveLength(1)
    cleanup(div)
  })

  it("is the inverse of readEditorState for round trips", () => {
    const div = mount()
    const cases = [
      "",
      "plain",
      "before [[Note]] after",
      "[[A]][[B]]",
      "one\ntwo\n[[Three]]",
    ]
    for (const text of cases) {
      renderTextToEditor(div, text)
      const { text: out } = readEditorState(div)
      expect(out).toBe(text)
    }
    cleanup(div)
  })
})

describe("readEditorState", () => {
  it("returns the text length as the caret when no selection sits in the editor", () => {
    const div = mount()
    renderTextToEditor(div, "abc [[Note]] def")
    const { text, caret } = readEditorState(div)
    expect(text).toBe("abc [[Note]] def")
    // Selection isn't in our editor — caret falls back to text length.
    expect(caret).toBe(text.length)
    cleanup(div)
  })

  it("reports a caret position that crosses pills correctly", () => {
    const div = mount()
    renderTextToEditor(div, "[[A]] tail")
    // Position the caret at the end of the text node ("tail").
    const textNode = Array.from(div.childNodes).find((n) => n.nodeType === Node.TEXT_NODE)!
    const sel = window.getSelection()!
    const range = document.createRange()
    range.setStart(textNode, 5) // after " tail"
    range.collapse(true)
    sel.removeAllRanges()
    sel.addRange(range)
    const { text, caret } = readEditorState(div)
    expect(text).toBe("[[A]] tail")
    expect(caret).toBe(text.length)
    cleanup(div)
  })
})

describe("setCaretAtTextOffset", () => {
  it("places the caret inside a text node at the correct offset", () => {
    const div = mount()
    renderTextToEditor(div, "hello world")
    setCaretAtTextOffset(div, 5) // after "hello"
    const { caret } = readEditorState(div)
    expect(caret).toBe(5)
    cleanup(div)
  })

  it("snaps to after a pill when the offset lands inside one", () => {
    const div = mount()
    renderTextToEditor(div, "before [[Note]] after")
    // "before " is 7 chars; pill is 8 chars (`[[Note]]`). Midpoint = 11.
    // Offset 13 (7 + 6) > midpoint → caret snaps to right after the pill,
    // which corresponds to text offset 15 ("before " + "[[Note]]").
    setCaretAtTextOffset(div, 13)
    const { caret } = readEditorState(div)
    expect(caret).toBe(15)
    cleanup(div)
  })
})

describe("insertTextAtCaret", () => {
  it("inserts a text node at the caret and advances it past the insertion", () => {
    const div = mount()
    renderTextToEditor(div, "hello world")
    setCaretAtTextOffset(div, 5) // between "hello" and " world"
    insertTextAtCaret(", there")
    const { text, caret } = readEditorState(div)
    expect(text).toBe("hello, there world")
    expect(caret).toBe("hello, there".length)
    cleanup(div)
  })

  it("is a no-op for empty input", () => {
    const div = mount()
    renderTextToEditor(div, "abc")
    setCaretAtTextOffset(div, 3)
    insertTextAtCaret("")
    expect(readEditorState(div).text).toBe("abc")
    cleanup(div)
  })
})

describe("insertLineBreakAtCaret", () => {
  it("inserts a <br> and leaves the caret on the line below", () => {
    const div = mount()
    renderTextToEditor(div, "one")
    setCaretAtTextOffset(div, 3)
    insertLineBreakAtCaret()
    const { text } = readEditorState(div)
    expect(text).toBe("one\n")
    expect(div.querySelectorAll("br")).toHaveLength(1)
    cleanup(div)
  })
})

describe("skill pills", () => {
  it("makeSkillPill produces a span with data-kind=skill and the skill class", () => {
    const pill = makeSkillPill("critique")
    expect(pill.dataset.kind).toBe("skill")
    expect(pill.dataset.target).toBe("critique")
    expect(pill.classList.contains(PILL_CLASS)).toBe(true)
    expect(pill.classList.contains(SKILL_PILL_CLASS)).toBe(true)
    expect(pill.getAttribute("contenteditable")).toBe("false")
  })

  it("renderTextToEditor turns `[[skill:name]]` into a skill pill", () => {
    const div = mount()
    renderTextToEditor(div, "run [[skill:critique]] now")
    const pills = div.querySelectorAll(`.${SKILL_PILL_CLASS}`)
    expect(pills).toHaveLength(1)
    expect(pills[0].getAttribute("data-target")).toBe("critique")
    expect((pills[0] as HTMLElement).dataset.kind).toBe("skill")
    cleanup(div)
  })

  it("serializes skill pills back as `[[skill:name]]`", () => {
    const div = mount()
    renderTextToEditor(div, "first [[skill:summarize]] then [[Note]]")
    const { text } = readEditorState(div)
    expect(text).toBe("first [[skill:summarize]] then [[Note]]")
    cleanup(div)
  })

  it("note and skill pills coexist as distinct atomic spans", () => {
    const div = mount()
    renderTextToEditor(div, "[[skill:a]][[b]]")
    const notePills = Array.from(div.querySelectorAll(`.${PILL_CLASS}`)).filter(
      (el) => (el as HTMLElement).dataset.kind === "note",
    )
    const skillPills = div.querySelectorAll(`.${SKILL_PILL_CLASS}`)
    expect(notePills).toHaveLength(1)
    expect(skillPills).toHaveLength(1)
    cleanup(div)
  })

  it("round-trips mixed skill/note/text content losslessly", () => {
    const div = mount()
    const cases = [
      "[[skill:a]]",
      "before [[skill:critique]] after",
      "[[skill:a]] and [[Note]] together",
      "line one\n[[skill:x]]\nline three",
    ]
    for (const text of cases) {
      renderTextToEditor(div, text)
      const { text: out } = readEditorState(div)
      expect(out).toBe(text)
    }
    cleanup(div)
  })
})
