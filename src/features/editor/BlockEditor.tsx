import { useEffect, useMemo, useRef } from "react"
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
    initializedKey.current = docKey
    parsing.current = true
    ;(async () => {
      const pre = preprocessWikilinks(initialMarkdown)
      const parsed = (await editor.tryParseMarkdownToBlocks(pre)) as PartialBlock[]
      const hydrated = hydrateWikilinkBlocks(parsed)
      editor.replaceBlocks(editor.document, hydrated.length ? hydrated : [{ type: "paragraph" }])
      lastEmitted.current = initialMarkdown
      parsing.current = false
      tryConsumePendingScroll()
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
      if (cd.items.length > 0 || cd.files.length > 0) return
      if (!Array.from(cd.types).includes("Files")) return
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

  return (
    <div ref={hostRef} className="h-full overflow-y-auto">
      <BlockNoteView
        editor={editor}
        theme={theme}
        onChange={async () => {
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
