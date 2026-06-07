/**
 * Block-mode "title is done" detector for auto-rename.
 *
 * In the block editor, pressing Enter at the end of a leading H1 creates a
 * trailing paragraph block — but BlockNote's markdown export trims it, so the
 * document text never gains a newline. A text-only signal therefore can't see
 * that the user moved past the title; this structural + cursor check can.
 *
 * The heading is "committed" once there's a block after the H1 *and* the
 * cursor is no longer inside the heading block. Requiring the cursor to have
 * left is what guarantees we never fire while the title is still being typed,
 * no matter what trailing blocks the editor keeps around. See `useAutoRename`
 * for how the signal is consumed.
 */

type HeadingShape = { type: string; id?: string; props?: { level?: number } }

export function headingCommitted(
  blocks: readonly unknown[],
  cursorBlockId: string | null | undefined,
): boolean {
  const bs = blocks as readonly HeadingShape[]
  const idx = bs.findIndex((b) => b.type === "heading" && b.props?.level === 1)
  if (idx === -1) return false
  // Nothing after the heading → still the only/last block → not committed.
  if (idx >= bs.length - 1) return false
  // A block exists after the H1. If we can read the cursor, only treat the
  // heading as committed once the cursor has actually left it; otherwise the
  // block-after-heading structure is the best signal we have.
  if (cursorBlockId == null) return true
  return bs[idx].id !== cursorBlockId
}
