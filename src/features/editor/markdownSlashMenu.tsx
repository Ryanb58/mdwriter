import type { BlockNoteEditor } from "@blocknote/core"
import {
  filterSuggestionItems,
  insertOrUpdateBlockForSlashMenu,
} from "@blocknote/core/extensions"
import {
  getDefaultReactSlashMenuItems,
  type DefaultReactSuggestionItem,
} from "@blocknote/react"
import { createMarkdownTableBlock } from "./markdownTables"

export type KeyedSlashItem = DefaultReactSuggestionItem & { key: string }

export const MARKDOWN_SLASH_KEYS = [
  "paragraph",
  "heading",
  "heading_2",
  "heading_3",
  "quote",
  "code_block",
  "bullet_list",
  "numbered_list",
  "check_list",
  "divider",
  "table",
  "image",
] as const

type MarkdownSlashKey = (typeof MARKDOWN_SLASH_KEYS)[number]

const MARKDOWN_SLASH_GROUPS: Record<MarkdownSlashKey, "Text" | "Lists" | "Insert"> = {
  paragraph: "Text",
  heading: "Text",
  heading_2: "Text",
  heading_3: "Text",
  quote: "Text",
  code_block: "Text",
  bullet_list: "Lists",
  numbered_list: "Lists",
  check_list: "Lists",
  divider: "Insert",
  table: "Insert",
  image: "Insert",
}

function keyedSlashItem(item: DefaultReactSuggestionItem): KeyedSlashItem {
  const key = (item as unknown as { key?: unknown }).key
  if (typeof key !== "string") {
    throw new Error("BlockNote returned a slash-menu item without a runtime string key")
  }
  return item as KeyedSlashItem
}

export function getMarkdownSlashMenuItems(
  editor: BlockNoteEditor<any, any, any>,
): KeyedSlashItem[] {
  const defaults = new Map(
    getDefaultReactSlashMenuItems(editor).map((item) => {
      const keyed = keyedSlashItem(item)
      return [keyed.key, keyed] as const
    }),
  )

  return MARKDOWN_SLASH_KEYS.map((key) => {
    const item = defaults.get(key)
    if (!item) {
      throw new Error(
        `BlockNote's default slash menu is missing the expected "${key}" item`,
      )
    }

    const groupedItem: KeyedSlashItem = {
      ...item,
      group: MARKDOWN_SLASH_GROUPS[key],
    }

    if (key === "table") {
      return {
        ...groupedItem,
        onItemClick: () =>
          insertOrUpdateBlockForSlashMenu(editor, createMarkdownTableBlock()),
      }
    }

    return groupedItem
  })
}

export function filterMarkdownSlashMenuItems(
  editor: BlockNoteEditor<any, any, any>,
  query: string,
): KeyedSlashItem[] {
  return filterSuggestionItems(getMarkdownSlashMenuItems(editor), query)
}
