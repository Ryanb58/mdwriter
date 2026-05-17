/**
 * DOM helpers for the contenteditable chat composer. The composer's "value"
 * stays a plain string (for trigger detection, prompt building, persistence)
 * while the DOM renders `[[Name]]` runs as atomic non-editable pill spans.
 *
 * The DOM is the source of truth — React state is denormalized from it on
 * every input event. Reverse syncing (state → DOM) only happens for
 * structural changes the user can't make by typing: pill insertions, slash
 * command applies, draft-request seeding.
 */

export const PILL_CLASS = "ai-pill"
export const SKILL_PILL_CLASS = "ai-pill-skill"
const PILL_PATTERN = /\[\[(skill:)?([^\]\n[]+)\]\]/g

/** Replace the editor's content so it mirrors `text`, expanding pill runs
 *  (`[[Name]]`, `[[skill:name]]`) into atomic non-editable spans. */
export function renderTextToEditor(root: HTMLElement, text: string): void {
  root.replaceChildren()
  if (!text) return
  let lastIndex = 0
  PILL_PATTERN.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = PILL_PATTERN.exec(text)) !== null) {
    const before = text.slice(lastIndex, m.index)
    if (before) appendTextWithBreaks(root, before)
    const isSkill = m[1] === "skill:"
    root.appendChild(isSkill ? makeSkillPill(m[2]) : makePill(m[2]))
    lastIndex = m.index + m[0].length
  }
  const tail = text.slice(lastIndex)
  if (tail) appendTextWithBreaks(root, tail)
}

/** Build a single atomic note pill span for the given target. */
export function makePill(target: string): HTMLSpanElement {
  const span = document.createElement("span")
  span.className = PILL_CLASS
  // Use setAttribute so the change is observable in jsdom (which doesn't
  // reflect the contentEditable property to the attribute).
  span.setAttribute("contenteditable", "false")
  span.dataset.target = target
  span.dataset.kind = "note"
  span.textContent = target
  return span
}

/** Build a single atomic skill pill span. Visually distinct from note pills
 *  (lightning glyph via CSS, accent tint) and serializes back as
 *  `[[skill:name]]`. */
export function makeSkillPill(target: string): HTMLSpanElement {
  const span = document.createElement("span")
  span.className = `${PILL_CLASS} ${SKILL_PILL_CLASS}`
  span.setAttribute("contenteditable", "false")
  span.dataset.target = target
  span.dataset.kind = "skill"
  span.textContent = target
  return span
}

function appendTextWithBreaks(root: HTMLElement, text: string): void {
  const lines = text.split("\n")
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) root.appendChild(document.createElement("br"))
    if (lines[i]) root.appendChild(document.createTextNode(lines[i]))
  }
}

/**
 * Serialize the editor's DOM back to (text, caret). Pills count as their
 * `[[Name]]` text length, `<br>` counts as a newline, text nodes contribute
 * their content verbatim. `caret` is the text offset of the current
 * selection's focus; when no selection sits in this editor (e.g. focus on a
 * button outside it), the caret is reported as the total text length so
 * callers don't have to special-case a sentinel.
 */
export function readEditorState(root: HTMLElement): { text: string; caret: number } {
  const sel = window.getSelection()
  const focusNode = sel && sel.rangeCount > 0 ? sel.focusNode : null
  const focusOffset = sel?.focusOffset ?? 0
  const focusInEditor = focusNode != null && root.contains(focusNode)

  let text = ""
  let caret = focusInEditor ? -1 : -2

  function recordCaretAt(localOffset: number) {
    if (caret < 0) caret = text.length + localOffset
  }

  function walk(node: Node) {
    if (focusInEditor && caret < 0 && node === focusNode) {
      if (node.nodeType === Node.TEXT_NODE) {
        recordCaretAt(focusOffset)
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        let acc = 0
        for (let i = 0; i < focusOffset; i++) {
          acc += textLengthOf(node.childNodes[i])
        }
        recordCaretAt(acc)
      }
    }
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent ?? ""
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const el = node as HTMLElement
    if (el.classList.contains(PILL_CLASS)) {
      text += serializePill(el)
      return
    }
    if (el.tagName === "BR") {
      text += "\n"
      return
    }
    for (const c of Array.from(el.childNodes)) walk(c)
  }

  walk(root)
  if (caret < 0) caret = text.length
  return { text, caret }
}

/** Serialized text form of a pill: `[[Name]]` for notes, `[[skill:name]]`
 *  for skills. The agent resolves both at run time via filesystem reads. */
function serializePill(el: HTMLElement): string {
  const target = el.dataset.target ?? el.textContent ?? ""
  if (el.dataset.kind === "skill") return `[[skill:${target}]]`
  return `[[${target}]]`
}

/** Total serialized text length contributed by a subtree. */
function textLengthOf(node: Node | undefined): number {
  if (!node) return 0
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? "").length
  if (node.nodeType !== Node.ELEMENT_NODE) return 0
  const el = node as HTMLElement
  if (el.classList.contains(PILL_CLASS)) {
    return serializePill(el).length
  }
  if (el.tagName === "BR") return 1
  let sum = 0
  for (const c of Array.from(el.childNodes)) sum += textLengthOf(c)
  return sum
}

/** Move the selection caret to the DOM position corresponding to a text
 *  offset. Positions inside a pill snap to the nearest side since pills
 *  are atomic — the caret never lives inside one. */
export function setCaretAtTextOffset(root: HTMLElement, target: number): void {
  const pos = positionAtTextOffset(root, target)
  if (!pos) return
  const range = document.createRange()
  range.setStart(pos.node, pos.offset)
  range.collapse(true)
  const sel = window.getSelection()
  if (!sel) return
  sel.removeAllRanges()
  sel.addRange(range)
}

function positionAtTextOffset(
  root: HTMLElement,
  target: number,
): { node: Node; offset: number } | null {
  let acc = 0
  let result: { node: Node; offset: number } | null = null

  function snapToAtom(el: HTMLElement, lenWithin: number, totalLen: number) {
    const parent = el.parentNode!
    const idx = Array.from(parent.childNodes).indexOf(el as ChildNode)
    result = { node: parent, offset: lenWithin < totalLen / 2 ? idx : idx + 1 }
  }

  function walk(node: Node): boolean {
    if (result) return true
    if (node.nodeType === Node.TEXT_NODE) {
      const len = (node.textContent ?? "").length
      if (target >= acc && target <= acc + len) {
        result = { node, offset: target - acc }
        return true
      }
      acc += len
      return false
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return false
    const el = node as HTMLElement
    if (el.classList.contains(PILL_CLASS)) {
      const totalLen = serializePill(el).length
      if (target >= acc && target <= acc + totalLen) {
        snapToAtom(el, target - acc, totalLen)
        return true
      }
      acc += totalLen
      return false
    }
    if (el.tagName === "BR") {
      if (target >= acc && target <= acc + 1) {
        snapToAtom(el, target - acc, 1)
        return true
      }
      acc += 1
      return false
    }
    for (const c of Array.from(el.childNodes)) {
      if (walk(c)) return true
    }
    return false
  }

  walk(root)
  if (!result) result = { node: root, offset: root.childNodes.length }
  return result
}

/**
 * Find the pill (if any) immediately before the current collapsed caret.
 * Used to atomically delete a pill on Backspace — browsers vary on whether
 * Backspace removes an adjacent contenteditable=false node cleanly, so we
 * handle it ourselves.
 */
export function pillBeforeCaret(root: HTMLElement): HTMLElement | null {
  const sel = window.getSelection()
  if (!sel || !sel.isCollapsed || sel.rangeCount === 0) return null
  const range = sel.getRangeAt(0)
  if (!root.contains(range.startContainer)) return null

  let node: Node | null = range.startContainer
  let offset = range.startOffset

  // Caret in the middle of text → not adjacent to a pill.
  if (node.nodeType === Node.TEXT_NODE) {
    if (offset > 0) return null
    // At start of a text node: jump to the text node's preceding sibling chain.
  } else if (node.nodeType === Node.ELEMENT_NODE) {
    if (offset === 0) {
      // At the very start of this element — walk out to find a previous sibling.
    } else {
      const candidate = node.childNodes[offset - 1] ?? null
      return isPill(candidate) ? (candidate as HTMLElement) : null
    }
  }

  // Walk up looking for a previousSibling at any level (still within root).
  let cursor: Node = node
  while (cursor !== root) {
    if (cursor.previousSibling) {
      const sibling = cursor.previousSibling
      return isPill(sibling) ? (sibling as HTMLElement) : null
    }
    if (!cursor.parentNode || cursor.parentNode === root.parentNode) return null
    cursor = cursor.parentNode
  }
  return null
}

function isPill(node: Node | null): boolean {
  return node instanceof HTMLElement && node.classList.contains(PILL_CLASS)
}

/**
 * Insert plain text at the current collapsed caret (or replace the current
 * range). Uses the Range/Selection APIs rather than the deprecated
 * `document.execCommand("insertText")`.
 */
export function insertTextAtCaret(text: string): void {
  if (!text) return
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return
  const range = sel.getRangeAt(0)
  range.deleteContents()
  const node = document.createTextNode(text)
  range.insertNode(node)
  const next = document.createRange()
  next.setStartAfter(node)
  next.collapse(true)
  sel.removeAllRanges()
  sel.addRange(next)
}

/**
 * Insert a soft line break (`<br>`) at the current caret. Replaces the
 * deprecated `document.execCommand("insertLineBreak")` with a deterministic
 * Range-based implementation.
 */
export function insertLineBreakAtCaret(): void {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return
  const range = sel.getRangeAt(0)
  range.deleteContents()
  const br = document.createElement("br")
  range.insertNode(br)
  const next = document.createRange()
  next.setStartAfter(br)
  next.collapse(true)
  sel.removeAllRanges()
  sel.addRange(next)
}
