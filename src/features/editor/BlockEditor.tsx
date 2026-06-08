import { useCallback, useEffect, useMemo, useRef } from "react"
import type { PartialBlock } from "@blocknote/core"
import { useCreateBlockNote, SuggestionMenuController } from "@blocknote/react"
import { BlockNoteView } from "@blocknote/mantine"
import "@blocknote/mantine/style.css"
import { convertFileSrc } from "@tauri-apps/api/core"
import { readText } from "@tauri-apps/plugin-clipboard-manager"
import { useResolvedTheme } from "../settings/useTheme"
import { useStore } from "../../lib/store"
import {
  saveImage,
  guessMimeFromName,
  readClipboardImageAsPng,
  resolveAgainstDocDir,
} from "../../lib/imagePaste"
import { plainPasteToBlocks } from "../../lib/plainPaste"
import { editorSchema, setWikilinkNotes } from "./wikilinkInline"
import {
  hydrateWikilinkBlocks,
  preprocessWikilinks,
  postprocessWikilinks,
} from "./wikilinkRoundtrip"
import { useLinkActivation } from "./useLinkActivation"
import { useVaultNotes, type VaultNote } from "../../lib/vaultNotes"
import { WikilinkSuggestionMenu } from "./WikilinkSuggestionMenu"
import { findNthBlockMatch } from "./blockTextSearch"
import { flashHighlight } from "./flashHighlight"
import { headingCommitted } from "./headingCommit"

export function BlockEditor({
  initialMarkdown,
  onChangeMarkdown,
  docKey,
}: {
  initialMarkdown: string
  onChangeMarkdown: (md: string) => void
  docKey: string
}) {
  const initializedKey = useRef<string | null>(null)
  // True while the init effect is awaiting the async parse — see usage below.
  const parsing = useRef(false)
  const lastEmitted = useRef<string>("")
  const theme = useResolvedTheme()
  const hostRef = useRef<HTMLDivElement | null>(null)
  const notes = useVaultNotes()

  // Keep the inline-content renderer's module-local note list in sync with
  // the live vault. The renderer can't `useStore` because BlockNote renders
  // it outside our React tree.
  useEffect(() => {
    setWikilinkNotes(notes)
  }, [notes])

  const editor = useCreateBlockNote(
    useMemo(
      () => ({
        schema: editorSchema,
        uploadFile: async (file: File): Promise<string> => {
          try {
            const { rootPath, openDoc, settings } = useStore.getState()
            if (!rootPath || !openDoc) throw new Error("No vault or doc context")
            const bytes = new Uint8Array(await file.arrayBuffer())
            const mime =
              file.type || guessMimeFromName(file.name) || "application/octet-stream"
            const result = await saveImage({
              bytes,
              mime,
              vaultRoot: rootPath,
              docPath: openDoc.path,
              location: settings.imagesLocation,
              template: settings.imageFilenameTemplate,
            })
            console.debug("[paste] image saved", {
              relativePath: result.relativePath,
              absolutePath: result.absolutePath,
            })
            return result.relativePath
          } catch (err) {
            // BlockNote leaves its loading block in place when uploadFile
            // rejects; without this log a paste failure looks identical
            // to a paste still in flight.
            console.error("[image paste] uploadFile failed:", err)
            throw err
          }
        },
        resolveFileUrl: async (stored: string): Promise<string> => {
          if (/^https?:\/\//i.test(stored)) return stored
          if (stored.startsWith("asset:") || stored.startsWith("data:")) return stored
          const { openDoc } = useStore.getState()
          if (!openDoc) return stored
          return convertFileSrc(resolveAgainstDocDir(openDoc.path, stored))
        },
      }),
      [],
    ),
  )

  function tryConsumePendingScroll() {
    const { pendingScroll, openDoc, setPendingScroll } = useStore.getState()
    if (!pendingScroll || !openDoc || openDoc.path !== pendingScroll.path) return
    const docBlocks = editor.document as Parameters<typeof findNthBlockMatch>[0]
    // Fall back to the first block when the match isn't in any block — the
    // matchText may live in frontmatter (which BlockNote strips on parse)
    // or in a block type our text extractor doesn't reach.
    let target = findNthBlockMatch(docBlocks, pendingScroll.matchText, pendingScroll.occurrence)
    if (!target) {
      const first = (docBlocks as Array<{ id?: string }> | null | undefined)?.[0]
      if (!first?.id) {
        setPendingScroll(null)
        return
      }
      target = { block: first as never, localIndex: 0 }
    }
    try {
      editor.setTextCursorPosition(target.block as never, "start")
    } catch {
      // Block may have been removed in a race; clearing pendingScroll below
      // still lets the next hit succeed.
    }
    const id = (target.block as { id?: string }).id
    setPendingScroll(null)
    if (!id) return
    waitForBlockNode(hostRef, id, (node) => {
      // Instant (not smooth) scroll so the flash paints at the settled
      // viewport position rather than chasing an in-flight smooth scroll.
      node.scrollIntoView({ block: "center", behavior: "auto" })
      requestAnimationFrame(() => flashHighlight(node))
    })
  }

  useEffect(() => {
    if (initializedKey.current === docKey) return
    // docKey embeds the file path, so a rename (e.g. autoRename-from-H1)
    // changes the key even though the doc body is identical to what the
    // editor just emitted. Re-parsing in that case clobbers the user's
    // live cursor position — skip it. This is only valid as a re-init
    // optimization: on the very first init, the editor is still in its
    // empty-default state, so we must run the parse + focus pass even when
    // both strings happen to be "".
    const isFirstInit = initializedKey.current === null
    if (!isFirstInit && initialMarkdown === lastEmitted.current) {
      initializedKey.current = docKey
      return
    }
    initializedKey.current = docKey
    parsing.current = true
    ;(async () => {
      const pre = preprocessWikilinks(initialMarkdown)
      const parsed = (await editor.tryParseMarkdownToBlocks(pre)) as PartialBlock[]
      const hydrated = hydrateWikilinkBlocks(parsed)
      // Only replace when there's actual content to load. For a brand-new
      // empty file, BlockNote's editor already has the default empty
      // paragraph it created in useCreateBlockNote — replacing it with a
      // freshly-built paragraph swaps plugin state in a way that makes
      // the heading input rule silently no-op against it.
      if (hydrated.length > 0) {
        editor.replaceBlocks(editor.document, hydrated)
      }
      lastEmitted.current = initialMarkdown
      parsing.current = false
      // If a search/palette jump is queued, it owns cursor + focus. Also bail
      // when the editor is already focused — happens when an external reload
      // (file watcher / AI apply) lands while the user is typing. Otherwise
      // land the cursor in the first block so the first keystroke after open
      // goes somewhere.
      const hadPendingScroll = !!useStore.getState().pendingScroll
      tryConsumePendingScroll()
      if (!hadPendingScroll && !editor.isFocused()) {
        // For freshly-created files (createNewFile sets pendingCursorAtEnd
        // to the new path), land the cursor at the end of the first block —
        // which for a `# ` seed is inside the empty H1, ready for the user's
        // title keystrokes. For any other open, "start" keeps the prior
        // behavior.
        const { openDoc, pendingCursorAtEnd, setPendingCursorAtEnd } = useStore.getState()
        const placement: "start" | "end" =
          pendingCursorAtEnd && openDoc && pendingCursorAtEnd === openDoc.path ? "end" : "start"
        if (placement === "end") setPendingCursorAtEnd(null)
        const firstBlock = (editor.document as Array<{ id?: string }>)[0]
        if (firstBlock) {
          try {
            editor.setTextCursorPosition(firstBlock as never, placement)
            editor.focus()
          } catch {
            // Block went away mid-frame; nothing to recover.
          }
        }
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKey, initialMarkdown, editor])

  // `parsing` guards against racing the init effect — when switching files,
  // the new blocks aren't in `editor.document` until the async parse above
  // resolves, so firing earlier would walk the previous file's tree.
  const pendingScroll = useStore((s) => s.pendingScroll)
  useEffect(() => {
    if (!pendingScroll) return
    if (initializedKey.current !== docKey) return
    if (parsing.current) return
    tryConsumePendingScroll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingScroll, docKey])

  // WKWebView reports clipboard images as types=["Files"] with empty
  // items/files. BlockNote's paste plugin never fires uploadFile, so
  // catch it ourselves and insert via the editor API.
  useEffect(() => {
    async function onPaste(e: ClipboardEvent) {
      const cd = e.clipboardData
      if (!cd) return
      // WKWebView surfaces a clipboard image as types=["Files"] with empty
      // items/files. Anything else (text, html, real files) is left to the
      // default handler.
      const types = Array.from(cd.types)
      const isWkImagePaste =
        cd.items.length === 0 && cd.files.length === 0 && types.includes("Files")
      if (!isWkImagePaste) {
        // Not the WKWebView empty-clipboard case. If the clipboard carries
        // image bytes directly, BlockNote's own paste plugin handles it via
        // uploadFile (which logs its own "image saved" line); otherwise the
        // default handler takes the text/markdown/etc.
        const hasImage =
          Array.from(cd.items).some((it) => it.type.startsWith("image/")) ||
          Array.from(cd.files).some((f) => f.type.startsWith("image/"))
        if (hasImage) {
          console.debug("[paste] image → BlockNote uploadFile")
        } else if (types.includes("text/plain")) {
          console.debug("[paste] plain text → default handler")
        } else {
          console.debug("[paste] non-image paste → default handler", { types })
        }
        return
      }
      const { rootPath, openDoc, settings } = useStore.getState()
      if (!rootPath || !openDoc) return
      e.preventDefault()
      try {
        const bytes = await readClipboardImageAsPng()
        if (!bytes) return
        const result = await saveImage({
          bytes,
          mime: "image/png",
          vaultRoot: rootPath,
          docPath: openDoc.path,
          location: settings.imagesLocation,
          template: settings.imageFilenameTemplate,
        })
        console.debug("[paste] image saved", {
          relativePath: result.relativePath,
          absolutePath: result.absolutePath,
        })
        const cursor = editor.getTextCursorPosition()
        editor.insertBlocks(
          [{ type: "image", props: { url: result.relativePath } }],
          cursor.block,
          "after",
        )
      } catch (err) {
        console.error("[image paste] clipboard fallback failed:", err)
      }
    }
    document.addEventListener("paste", onPaste, true)
    return () => document.removeEventListener("paste", onPaste, true)
  }, [editor])

  // Cmd/Ctrl+Shift+V → paste without formatting. WKWebView doesn't fire a
  // native paste event for this shortcut, so we read the clipboard text
  // ourselves and bypass BlockNote's markdown/HTML detection by inserting
  // the text directly via the editor API.
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    async function onKeyDown(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey
      if (!mod || !e.shiftKey) return
      if (e.key !== "v" && e.key !== "V") return
      e.preventDefault()
      e.stopPropagation()
      try {
        const text = await readText()
        if (!text) return
        console.debug("[paste] plain text pasted (no-format)", { chars: text.length })
        const { firstLine, tailBlocks } = plainPasteToBlocks(text)
        const cursor = editor.getTextCursorPosition()
        if (firstLine) editor.insertInlineContent(firstLine)
        if (tailBlocks.length > 0) {
          const inserted = editor.insertBlocks(tailBlocks, cursor.block, "after")
          const last = inserted[inserted.length - 1]
          if (last) editor.setTextCursorPosition(last, "end")
        }
      } catch (err) {
        console.error("[plain paste] failed:", err)
      }
    }
    host.addEventListener("keydown", onKeyDown, true)
    return () => host.removeEventListener("keydown", onKeyDown, true)
  }, [editor])

  useLinkActivation(hostRef)

  // Publish the auto-rename "title is done" signal: the first H1 is committed
  // once the cursor has left the heading block (Enter pressed / clicked away).
  // Block mode trims the trailing paragraph from the markdown export, so the
  // doc text never changes — this is the only reliable signal. Path-keyed so
  // it can't leak to another document.
  const publishHeadingCommit = useCallback(() => {
    const path = useStore.getState().openDoc?.path ?? null
    if (!path) return
    let cursorBlockId: string | undefined
    try {
      cursorBlockId = editor.getTextCursorPosition()?.block?.id
    } catch {
      cursorBlockId = undefined
    }
    useStore
      .getState()
      .setHeadingCommittedPath(headingCommitted(editor.document, cursorBlockId) ? path : null)
  }, [editor])

  // Push the current selection text into the store so the AI composer can
  // surface it as a context chip. Empty selections clear the chip; an unmount
  // (e.g. switching to raw mode) clears as well.
  useEffect(() => {
    const setSel = useStore.getState().setEditorSelection
    const fire = () => {
      const text = editor.getSelectedText()
      const path = useStore.getState().openDoc?.path ?? null
      setSel(text ? { text, sourcePath: path } : null)
      // Moving the cursor out of the heading is the "title is done" moment.
      publishHeadingCommit()
    }
    const unsub = editor.onSelectionChange(fire)
    return () => {
      unsub()
      useStore.getState().setEditorSelection(null)
    }
  }, [editor, publishHeadingCommit])

  return (
    <div ref={hostRef} className="h-full overflow-y-auto">
      <BlockNoteView
        editor={editor}
        theme={theme}
        onChange={async () => {
          // Keep the auto-rename commitment signal fresh on structural edits
          // too (e.g. the Enter that adds the block after the heading).
          publishHeadingCommit()
          const md = await editor.blocksToMarkdownLossy()
          // The export path emits our wikilinks as bracketed text already
          // (via the inline spec's toExternalHTML); the postprocess only
          // matters if BlockNote's HTML→markdown step escapes a bracket.
          const out = postprocessWikilinks(md)
          if (out !== lastEmitted.current) {
            lastEmitted.current = out
            onChangeMarkdown(out)
          }
        }}
      >
        <SuggestionMenuController
          triggerCharacter="[["
          getItems={async (query: string) => filterForMenu(notes, query)}
          suggestionMenuComponent={WikilinkSuggestionMenu}
          onItemClick={(item) => {
            // BlockNote's SuggestionMenuWrapper has already deleted the
            // `[[` trigger plus any query characters before invoking us.
            // Insert our atomic wikilink node followed by a space so the
            // user can keep typing without a no-break-space surprise.
            editor.insertInlineContent([
              {
                type: "wikilink",
                props: { target: item.target, alias: "" },
              },
              " ",
            ] as never)
          }}
        />
      </BlockNoteView>
    </div>
  )
}

// Even after `replaceBlocks`, BlockNote may not have rendered the new block
// nodes by the time we look them up. Poll a few frames for the DOM to catch
// up before giving up.
const MAX_BLOCK_NODE_POLL_FRAMES = 10
function waitForBlockNode(
  hostRef: React.RefObject<HTMLDivElement | null>,
  id: string,
  cb: (node: HTMLElement) => void,
  attempt = 0,
) {
  const host = hostRef.current
  if (host) {
    const node = host.querySelector(`[data-id="${CSS.escape(id)}"]`)
    if (node instanceof HTMLElement) {
      cb(node)
      return
    }
  }
  if (attempt >= MAX_BLOCK_NODE_POLL_FRAMES) return
  requestAnimationFrame(() => waitForBlockNode(hostRef, id, cb, attempt + 1))
}

type WikilinkMenuItem = {
  title: string
  subtitle: string
  target: string
}

/**
 * Substring match against note name and rel path. BlockNote strips the
 * full multi-character trigger (`[[`) before passing the query, so we get
 * the raw user-typed text after the brackets.
 */
function filterForMenu(notes: VaultNote[], query: string): WikilinkMenuItem[] {
  const q = query.trim().toLowerCase()
  const scored: { item: WikilinkMenuItem; score: number }[] = []
  for (const n of notes) {
    const name = n.name.toLowerCase()
    const rel = n.rel.toLowerCase()
    const nameIdx = name.indexOf(q)
    const relIdx = rel.indexOf(q)
    if (q && nameIdx < 0 && relIdx < 0) continue
    const score = !q ? 0 : nameIdx >= 0 ? nameIdx : 1000 + relIdx
    scored.push({
      item: {
        title: n.name,
        subtitle: n.rel,
        target: n.name,
      },
      score,
    })
  }
  scored.sort((a, b) => a.score - b.score || a.item.title.localeCompare(b.item.title))
  return scored.slice(0, 12).map((s) => s.item)
}
