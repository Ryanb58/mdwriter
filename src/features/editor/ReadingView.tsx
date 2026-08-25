import { useEffect, useMemo, useState } from "react"
import { convertFileSrc } from "@tauri-apps/api/core"
import { renderToStaticMarkup } from "react-dom/server"
import ReactMarkdown, { defaultUrlTransform } from "react-markdown"
import remarkGfm from "remark-gfm"
import { ipc } from "../../lib/ipc"
import { getBody } from "../../lib/doc"
import { resolveAgainstDocDir } from "../../lib/imagePaste"
import { documentStylesheetPaths } from "./documentStyles"

const BASE_CSS = `
:root { color-scheme: light dark; }
body { margin: 0; background: Canvas; color: CanvasText; }
.mdwriter-document { box-sizing: border-box; max-width: 44rem; margin: 0 auto; padding: 2rem 3rem 5rem; font: 16px/1.7 system-ui, sans-serif; }
.mdwriter-document :where(img, video) { max-width: 100%; height: auto; }
.mdwriter-document pre { overflow-x: auto; padding: 1rem; border-radius: .4rem; background: color-mix(in srgb, CanvasText 8%, Canvas); }
.mdwriter-document code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.mdwriter-document blockquote { margin-inline: 0; padding-inline-start: 1rem; border-inline-start: 3px solid color-mix(in srgb, CanvasText 30%, Canvas); }
.mdwriter-document table { border-collapse: collapse; width: 100%; }
.mdwriter-document th, .mdwriter-document td { border: 1px solid color-mix(in srgb, CanvasText 25%, Canvas); padding: .4rem .6rem; text-align: start; }
`

type LoadedStyle = { path: string; text: string }

/**
 * A rendered document in a sandboxed iframe. Stylesheets are read through the
 * existing vault-scoped IPC command, then live only in the iframe: a note can
 * customize its own presentation without changing mdwriter's UI or editor.
 */
export function ReadingView({ text, documentPath, vaultRoot }: {
  text: string
  documentPath: string
  vaultRoot: string | null
}) {
  const stylesheetPaths = useMemo(
    () => vaultRoot ? documentStylesheetPaths(text, documentPath, vaultRoot) : [],
    [text, documentPath, vaultRoot],
  )
  const [styles, setStyles] = useState<LoadedStyle[]>([])

  useEffect(() => {
    let current = true
    void Promise.all(stylesheetPaths.map(async (path) => {
      try {
        const snapshot = await ipc.readFile(path)
        return { path, text: snapshot.text }
      } catch {
        // A global or sidecar stylesheet is optional. A bad/missing reference
        // must never prevent the note itself from being readable.
        return null
      }
    })).then((loaded) => {
      if (current) setStyles(loaded.filter((style): style is LoadedStyle => style !== null))
    })
    return () => { current = false }
  }, [stylesheetPaths])

  const srcDoc = useMemo(() => buildReadingDocument(getBody(text), documentPath, styles), [text, documentPath, styles])

  return (
    <iframe
      title="Styled reading view"
      sandbox=""
      srcDoc={srcDoc}
      className="h-full w-full border-0 bg-transparent"
    />
  )
}

export function buildReadingDocument(markdown: string, documentPath: string, styles: LoadedStyle[]): string {
  const html = renderToStaticMarkup(
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      urlTransform={(url) => transformDocumentUrl(url, documentPath)}
    >
      {markdown}
    </ReactMarkdown>,
  )
  // CSS is content, not markup. Escaping `<` ensures a malicious stylesheet
  // cannot close its own <style> tag inside srcDoc.
  const css = [BASE_CSS, ...styles.map((style) => style.text)]
    .join("\n")
    .replaceAll("<", "\\3c ")
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><main class="mdwriter-document">${html}</main></body></html>`
}

function transformDocumentUrl(url: string, documentPath: string): string {
  if (/^(?:https?:|data:|mailto:|tel:|#)/i.test(url)) return defaultUrlTransform(url)
  return convertFileSrc(resolveAgainstDocDir(documentPath, url))
}
