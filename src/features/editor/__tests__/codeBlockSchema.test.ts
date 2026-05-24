import { describe, it, expect } from "vitest"
import { BlockNoteEditor } from "@blocknote/core"
import { editorSchema } from "../wikilinkInline"

/**
 * Verifies the schema wiring for `@blocknote/code-block`: a fenced
 * `\`\`\`python` block must parse to a `codeBlock` block carrying the
 * `python` language tag. The Shiki tokenizer is exercised at render time
 * by the ProseMirror plugin, but the language tag landing in `props` is
 * the contract we need to keep stable for highlighting to fire.
 */
describe("editorSchema code block", () => {
  it("parses ```python fenced markdown into a codeBlock with language=python", async () => {
    const editor = BlockNoteEditor.create({ schema: editorSchema })
    const md = '```python\ndef func():\n    print("hello")\n```\n'
    const blocks = await editor.tryParseMarkdownToBlocks(md)

    const codeBlocks = blocks.filter((b) => b.type === "codeBlock")
    expect(codeBlocks.length).toBe(1)
    expect((codeBlocks[0] as { props: { language: string } }).props.language).toBe("python")
  })

  it("round-trips a python code block back to fenced markdown", async () => {
    const editor = BlockNoteEditor.create({ schema: editorSchema })
    const md = '```python\ndef func():\n    print("hello")\n```\n'
    const blocks = await editor.tryParseMarkdownToBlocks(md)
    editor.replaceBlocks(editor.document, blocks)
    const out = await editor.blocksToMarkdownLossy()
    expect(out).toMatch(/```python\n/)
    expect(out).toContain('print("hello")')
  })
})
