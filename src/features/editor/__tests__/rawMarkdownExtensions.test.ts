import { insertBracket } from "@codemirror/autocomplete"
import { defaultKeymap, history, historyKeymap, redo, undo } from "@codemirror/commands"
import { syntaxTree } from "@codemirror/language"
import { EditorSelection, EditorState, type Extension } from "@codemirror/state"
import { EditorView, keymap } from "@codemirror/view"
import { highlightTree } from "@lezer/highlight"
import { afterEach, describe, expect, it } from "vitest"
import { rawCodeLanguage, rawMarkdownExtensions, rawMarkdownHighlightStyle } from "../rawMarkdownExtensions"
import { applyWikilinkInsertion, decorateLinks, detectWikilinkTrigger } from "../wikilinkCM"
import { rawFindHighlightField, setRawFindHighlight } from "../rawFindHighlight"

function state(doc: string, anchor = doc.length, head = anchor, extra: Extension = []) {
  return EditorState.create({
    doc,
    selection: { anchor, head },
    extensions: [
      history(),
      rawMarkdownExtensions(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      extra,
    ],
  })
}

function highlights(doc: string) {
  const result: { text: string; classes: string }[] = []
  highlightTree(syntaxTree(state(doc)), rawMarkdownHighlightStyle, (from, to, classes) => {
    result.push({ text: doc.slice(from, to), classes })
  })
  return result
}

const views: EditorView[] = []
function view(doc: string, anchor = doc.length, head = anchor, extra: Extension = []) {
  const editor = new EditorView({ state: state(doc, anchor, head, extra), parent: document.body })
  views.push(editor)
  return editor
}

function key(editor: EditorView, name: string, shiftKey = false) {
  // CodeMirror's Escape/Tab accessibility handling also reads legacy keyCode.
  const keyCode = { Tab: 9, Escape: 27, Enter: 13, Backspace: 8 }[name] ?? 0
  const event = new KeyboardEvent("keydown", { key: name, keyCode, shiftKey, bubbles: true, cancelable: true })
  editor.contentDOM.dispatchEvent(event)
  return event
}

afterEach(() => {
  for (const editor of views.splice(0)) {
    editor.destroy()
    editor.dom.remove()
  }
})

describe("raw Markdown highlighting", () => {
  it("styles Markdown semantics including GFM without changing the source", () => {
    const doc = "# Heading\n\n**bold** *italic* ~~deleted~~ `code` [label](https://example.com)\n\n- [x] done"
    const spans = highlights(doc)
    for (const [text, style] of [
      ["Heading", "heading"], ["bold", "strong"], ["italic", "emphasis"],
      ["deleted", "strikethrough"], ["code", "code"], ["label", "link"],
      ["[x]", "literal"], ["#", "muted"],
    ]) {
      expect(spans.some((s) => s.text.includes(text) && s.classes.includes(`cm-syntax-${style}`)))
        .toBe(true)
    }
    expect(state(doc).doc.toString()).toBe(doc)
  })

  it.each([
    ["js", "const answer = 42", "const", "keyword"],
    ["JavaScript", "const answer = 42", "42", "literal"],
    ["ts", "const answer: number = 42", "number", "property"],
    ["jsx", "const el = <div />", "div", "keyword"],
    ["tsx", "const el = <div />", "div", "keyword"],
    ["css", "body { color: red; }", "color", "property"],
    ["html", '<div class="note">Hello</div>', "div", "keyword"],
  ])("highlights %s fenced code using the installed grammar", (lang, code, token, style) => {
    expect(highlights(`\`\`\`${lang}\n${code}\n\`\`\``)).toEqual(expect.arrayContaining([
      { text: token, classes: `cm-syntax-${style}` },
    ]))
  })

  it("accepts aliases and fence metadata, but leaves unknown or unlabelled code as code", () => {
    expect(rawCodeLanguage(" JS title=example")).toBe(rawCodeLanguage("javascript"))
    for (const lang of ["", "python", "unknown", "constructor", "__proto__"]) {
      expect(rawCodeLanguage(lang)).toBeNull()
      expect(highlights(`\`\`\`${lang}\nhello_world\n\`\`\``)).toEqual(expect.arrayContaining([
        { text: "hello_world", classes: "cm-syntax-code" },
      ]))
    }
  })

  it("coexists with wikilink and exact Find decorations as edits map their positions", () => {
    const editor = view("**bold** [[Note]]", 0, 0, [
      decorateLinks(() => []),
      rawFindHighlightField,
    ])
    editor.dispatch({ effects: setRawFindHighlight.of({ from: 2, to: 6 }) })
    expect(Array.from(editor.dom.querySelectorAll(".cm-syntax-strong"))
      .some((element) => element.textContent === "bold")).toBe(true)
    expect(editor.dom.querySelector(".cm-find-match-exact")?.textContent).toBe("bold")
    expect(editor.dom.querySelector(".wikilink")?.getAttribute("data-target")).toBe("Note")
    key(editor, "Tab")
    const match = editor.state.field(rawFindHighlightField).iter()
    expect([match.from, match.to]).toEqual([6, 10])
    expect(editor.dom.querySelector(".cm-find-match-exact")?.textContent).toBe("bold")
    expect(editor.dom.querySelector(".wikilink")?.textContent).toBe("[[Note]]")
  })
})

describe("raw Markdown indentation keymap", () => {
  it.each(["- child", "1. child", "- [ ] child", "> quoted", "plain text"])(
    "indents and outdents the whole current line (%s), preserving the cursor",
    (line) => {
      const editor = view(line, 2)
      expect(key(editor, "Tab").defaultPrevented).toBe(true)
      expect(editor.state.doc.toString()).toBe(`    ${line}`)
      expect(editor.state.selection.main.head).toBe(6)
      key(editor, "Tab", true)
      expect(editor.state.doc.toString()).toBe(line)
      expect(editor.state.selection.main.head).toBe(2)
    },
  )

  it("preserves selected text, relative indentation and the unselected end line", () => {
    const doc = "- parent\n    - child\nuntouched"
    const editor = view(doc, doc.indexOf("untouched"), 0)
    key(editor, "Tab")
    expect(editor.state.doc.toString()).toBe("    - parent\n        - child\nuntouched")
    expect(editor.state.selection.main.anchor).toBeGreaterThan(editor.state.selection.main.head)
    expect(undo(editor)).toBe(true)
    expect(editor.state.doc.toString()).toBe(doc)
    expect(redo(editor)).toBe(true)
    expect(editor.state.doc.toString()).toBe("    - parent\n        - child\nuntouched")
    key(editor, "Tab", true)
    expect(editor.state.doc.toString()).toBe(doc)
  })

  it("indents fenced code and blank lines without inserting literal tabs", () => {
    const doc = "```js\nconst x = 1\n\n```"
    const editor = view(doc, 6, doc.indexOf("\n```") + 1)
    key(editor, "Tab")
    expect(editor.state.doc.toString()).toBe("```js\n    const x = 1\n    \n```")
    key(editor, "Tab", true)
    expect(editor.state.doc.toString()).toBe(doc)
  })

  it("keeps Markdown Enter continuation ahead of the generic keymap", () => {
    const editor = view("- [ ] task")
    key(editor, "Enter")
    expect(editor.state.doc.toString()).toBe("- [ ] task\n- [ ] ")
  })

  it("outdents partial indentation and literal tabs without removing content", () => {
    const editor = view("  - two\n\t- tab\n- none", 0, 21)
    key(editor, "Tab", true)
    expect(editor.state.doc.toString()).toBe("- two\n- tab\n- none")
  })

  it("indents all cursor lines once and retains each cursor", () => {
    const editor = view("one\ntwo", 0, 0, EditorState.allowMultipleSelections.of(true))
    editor.dispatch({
      selection: EditorSelection.create([EditorSelection.cursor(1), EditorSelection.cursor(5)]),
    })
    key(editor, "Tab")
    expect(editor.state.doc.toString()).toBe("    one\n    two")
    expect(editor.state.selection.ranges.map((range) => range.head)).toEqual([5, 13])
  })

  it("respects read-only state and provides Escape then Tab to leave the editor", () => {
    const readonly = view("note", 4, 4, EditorState.readOnly.of(true))
    key(readonly, "Tab")
    key(readonly, "Tab", true)
    expect(readonly.state.doc.toString()).toBe("note")
    const editor = view("note")
    key(editor, "Escape")
    expect(key(editor, "Tab").defaultPrevented).toBe(false)
    expect(editor.state.doc.toString()).toBe("note")
  })
})

describe("raw Markdown brackets", () => {
  it.each([["(", ")"], ["[", "]"], ["{", "}"]])("pairs %s and skips its generated closer", (open, close) => {
    const initial = state("")
    const paired = insertBracket(initial, open)!.state
    expect(paired.doc.toString()).toBe(open + close)
    expect(paired.selection.main.head).toBe(1)
    const skipped = insertBracket(paired, close)!.state
    expect(skipped.doc.toString()).toBe(open + close)
    expect(skipped.selection.main.head).toBe(2)
  })

  it("wraps selections and deletes an empty pair before generic Backspace", () => {
    const wrapped = insertBracket(state("label", 0, 5), "[")!.state
    expect(wrapped.doc.toString()).toBe("[label]")
    expect(wrapped.sliceDoc(wrapped.selection.main.from, wrapped.selection.main.to)).toBe("label")
    const editor = view("[]", 1)
    key(editor, "Backspace")
    expect(editor.state.doc.toString()).toBe("")
  })

  it("leaves prose punctuation alone while using quote pairing inside JavaScript fences", () => {
    for (const punctuation of ["'", '"', "`", "*", "_"]) {
      expect(insertBracket(state(""), punctuation)).toBeNull()
    }
    const code = state("```js\n\n```", 6)
    expect(insertBracket(code, '"')!.state.doc.toString()).toBe('```js\n""\n```')
  })

  it("retains wikilink completion and consumes the generated closing brackets once", () => {
    let paired = insertBracket(state(""), "[")!.state
    paired = insertBracket(paired, "[")!.state
    expect(paired.doc.toString()).toBe("[[]]")
    expect(detectWikilinkTrigger(paired.doc.toString(), paired.selection.main.head))
      .toEqual({ start: 0, query: "" })
    const editor = view("")
    editor.setState(paired)
    applyWikilinkInsertion(editor, 0, 2, "My note")
    expect(editor.state.doc.toString()).toBe("[[My note]]")
    expect(editor.state.selection.main.head).toBe(11)
  })

  it("supports multiple selections without losing them", () => {
    const initial = state("one\ntwo", 0, 0, EditorState.allowMultipleSelections.of(true))
    const multiple = initial.update({
      selection: EditorSelection.create([EditorSelection.range(0, 3), EditorSelection.range(4, 7)]),
    }).state
    const paired = insertBracket(multiple, "(")!.state
    expect(paired.doc.toString()).toBe("(one)\n(two)")
    expect(paired.selection.ranges).toHaveLength(2)
  })
})
