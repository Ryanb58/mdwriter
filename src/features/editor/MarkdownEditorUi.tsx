import { CodeBlockIcon } from "@phosphor-icons/react"
import {
  AddBlockButton,
  BasicTextStyleButton,
  BlockTypeSelect,
  CreateLinkButton,
  DragHandleButton,
  DragHandleMenu,
  FileDeleteButton,
  FileReplaceButton,
  FormattingToolbar,
  FormattingToolbarController,
  RemoveBlockItem,
  SideMenu,
  SideMenuController,
  blockTypeSelectItems,
  useDictionary,
  useSelectedBlocks,
  type BlockTypeSelectItem,
} from "@blocknote/react"

export type ToolbarKind = "inline" | "image" | "file" | "none"

export function classifyFormattingSelection(
  blocks: readonly { type: string; content?: unknown }[],
): ToolbarKind {
  if (blocks.length === 0) return "none"

  if (blocks.every((block) => Array.isArray(block.content))) {
    return "inline"
  }

  if (blocks.length !== 1) return "none"
  if (blocks[0].type === "image") return "image"
  if (["audio", "video", "file"].includes(blocks[0].type)) return "file"

  return "none"
}

export function isUnsupportedMarkdownShortcut(
  event: Pick<
    KeyboardEvent,
    "metaKey" | "ctrlKey" | "shiftKey" | "code" | "key"
  >,
): boolean {
  if (!event.metaKey && !event.ctrlKey) return false

  const isU = event.code === "KeyU" || event.key.toLowerCase() === "u"
  if (!event.shiftKey && isU) return true

  return event.shiftKey && event.code === "Digit6"
}

function SelectCodeBlockIcon({ size }: { size?: string | number }) {
  return <CodeBlockIcon size={size} />
}

function requiredBlockTypeItem(
  items: BlockTypeSelectItem[],
  predicate: (item: BlockTypeSelectItem) => boolean,
  description: string,
): BlockTypeSelectItem {
  const item = items.find(predicate)
  if (!item) {
    throw new Error(`BlockNote is missing the ${description} block type choice`)
  }
  return item
}

function markdownBlockTypeSelectItems(
  dictionary: Parameters<typeof blockTypeSelectItems>[0],
): BlockTypeSelectItem[] {
  const defaults = blockTypeSelectItems(dictionary)
  const type = (blockType: string) => (item: BlockTypeSelectItem) =>
    item.type === blockType
  const heading = (level: number) => (item: BlockTypeSelectItem) =>
    item.type === "heading" &&
    item.props?.level === level &&
    item.props?.isToggleable === false

  return [
    requiredBlockTypeItem(defaults, type("paragraph"), "Paragraph"),
    requiredBlockTypeItem(defaults, heading(1), "Heading 1"),
    requiredBlockTypeItem(defaults, heading(2), "Heading 2"),
    requiredBlockTypeItem(defaults, heading(3), "Heading 3"),
    requiredBlockTypeItem(defaults, type("quote"), "Quote"),
    {
      name: dictionary.slash_menu.code_block.title,
      type: "codeBlock",
      icon: SelectCodeBlockIcon,
    },
    requiredBlockTypeItem(defaults, type("bulletListItem"), "Bullet List"),
    requiredBlockTypeItem(defaults, type("numberedListItem"), "Numbered List"),
    requiredBlockTypeItem(defaults, type("checkListItem"), "Checklist"),
  ]
}

function MarkdownFormattingToolbarContent() {
  const selectedBlocks = useSelectedBlocks()
  const dictionary = useDictionary()
  const kind = classifyFormattingSelection(selectedBlocks)

  if (kind === "none") return null

  if (kind === "image") {
    return (
      <FormattingToolbar>
        <FileReplaceButton />
        <FileDeleteButton />
      </FormattingToolbar>
    )
  }

  if (kind === "file") {
    return (
      <FormattingToolbar>
        <FileDeleteButton />
      </FormattingToolbar>
    )
  }

  return (
    <FormattingToolbar>
      <BlockTypeSelect items={markdownBlockTypeSelectItems(dictionary)} />
      <BasicTextStyleButton basicTextStyle="bold" />
      <BasicTextStyleButton basicTextStyle="italic" />
      <BasicTextStyleButton basicTextStyle="strike" />
      <BasicTextStyleButton basicTextStyle="code" />
      <CreateLinkButton />
    </FormattingToolbar>
  )
}

export function MarkdownFormattingToolbar() {
  return (
    <FormattingToolbarController
      formattingToolbar={MarkdownFormattingToolbarContent}
    />
  )
}

function MarkdownDragHandleMenu() {
  const dictionary = useDictionary()

  return (
    <DragHandleMenu>
      <RemoveBlockItem>{dictionary.drag_handle.delete_menuitem}</RemoveBlockItem>
    </DragHandleMenu>
  )
}

function MarkdownSideMenuContent() {
  return (
    <SideMenu>
      <AddBlockButton />
      <DragHandleButton dragHandleMenu={MarkdownDragHandleMenu} />
    </SideMenu>
  )
}

export function MarkdownSideMenu() {
  return <SideMenuController sideMenu={MarkdownSideMenuContent} />
}
