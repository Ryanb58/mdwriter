import { BlockNoteSchema, createCodeBlockSpec } from "@blocknote/core"
import { codeBlockOptions } from "@blocknote/code-block"
import { createReactInlineContentSpec } from "@blocknote/react"
import type { VaultNote } from "../../lib/vaultNotes"
import { resolveLinkTarget } from "../../lib/wikilinkResolve"
import { wikilinkTooltip } from "./linkAffordance"

/**
 * BlockNote needs to render the wikilink synchronously while the editor's
 * Store is React state. Rather than thread the vault tree through every
 * render via context (the inline content render function runs outside the
 * React tree we own), Tolaria's pattern of a module-local ref works fine —
 * the BlockEditor updates this whenever the notes list changes.
 */
let notesRef: VaultNote[] = []
export function setWikilinkNotes(notes: VaultNote[]) {
  notesRef = notes
}

/**
 * Custom inline content node for `[[target|alias]]` style references.
 * `content: "none"` means BlockNote treats the node as an atomic unit
 * (you can't put a cursor inside it), which is what we want for a link
 * chip — editing the target is via deletion + re-typing `[[`.
 */
export const wikilinkInlineSpec = createReactInlineContentSpec(
  {
    type: "wikilink",
    propSchema: {
      target: { default: "" },
      alias: { default: "" },
    },
    content: "none",
  } as const,
  {
    render: ({ inlineContent }) => {
      const target = String(inlineContent.props.target ?? "")
      const alias = String(inlineContent.props.alias ?? "")
      const resolved = target ? resolveLinkTarget(target, notesRef) : null
      const display = alias || target
      const className = resolved
        ? "wikilink wikilink--resolved"
        : "wikilink wikilink--unknown"
      return (
        <span
          className={className}
          data-target={target}
          data-alias={alias || undefined}
          title={resolved ? wikilinkTooltip(target, resolved.rel) : `Open ${target}`}
        >
          {display}
        </span>
      )
    },
    // BlockNote's markdown export goes through HTML, then a markdown
    // converter. Emitting the literal `[[target|alias]]` as text in the
    // exported HTML survives the round trip — the markdown converter
    // treats it as a plain text run, preserving the brackets.
    toExternalHTML: ({ inlineContent }) => {
      const target = String(inlineContent.props.target ?? "")
      const alias = String(inlineContent.props.alias ?? "")
      const body = alias ? `${target}|${alias}` : target
      return <>{`[[${body}]]`}</>
    },
  },
)

/**
 * BlockNote schema that adds the wikilink inline content type and overrides
 * the default codeBlock with a Shiki-backed variant from `@blocknote/code-block`
 * so fenced markdown blocks (```python …```) render with syntax highlighting.
 *
 * Uses the `.extend()` builder pattern recommended in the BlockNote docs
 * (https://www.blocknotejs.org/docs/features/blocks/code-blocks) — additive,
 * so defaults for unmentioned block / inline-content specs stay in place.
 */
export const editorSchema = BlockNoteSchema.create().extend({
  blockSpecs: {
    codeBlock: createCodeBlockSpec(codeBlockOptions),
  },
  inlineContentSpecs: {
    wikilink: wikilinkInlineSpec,
  },
})

export type EditorSchema = typeof editorSchema
