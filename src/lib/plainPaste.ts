import type { PartialBlock } from "@blocknote/core"

export type PlainPasteSplit = {
  firstLine: string
  tailBlocks: PartialBlock[]
}

// Cmd/Ctrl+Shift+V drops styling and any markdown/HTML interpretation.
// Each line of the pasted text becomes its own paragraph — this matches
// how Notion, Bear, and most block editors handle "paste without
// formatting". The first line is merged into the current block; the
// remainder are inserted as new sibling paragraphs.
export function plainPasteToBlocks(text: string): PlainPasteSplit {
  const normalized = text.replace(/\r\n?/g, "\n")
  const lines = normalized.split("\n")
  const firstLine = lines[0] ?? ""
  const tailBlocks: PartialBlock[] = lines.slice(1).map((line) => ({
    type: "paragraph",
    content: line,
  }))
  return { firstLine, tailBlocks }
}
