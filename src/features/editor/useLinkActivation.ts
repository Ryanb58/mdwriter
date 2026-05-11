import { useEffect, useRef } from "react"
import { useStore } from "../../lib/store"
import { useVaultNotes, type VaultNote } from "../../lib/vaultNotes"
import {
  decodeTarget,
  isInternalHref,
  resolveLinkTarget,
} from "../../lib/wikilinkResolve"

/**
 * Capture-phase click handler for the editor surface. Two kinds of links
 * are intercepted:
 *
 *   • `<span class="wikilink" data-target="…">` — our custom BlockNote inline
 *     content and the CodeMirror raw-mode decorator both expose this.
 *   • `<a href="…">` whose href looks vault-internal (no scheme, no anchor).
 *     BlockNote's standard link nodes are rendered as anchors; pasted markdown
 *     `[text](Note%20Name.md)` ends up here.
 *
 * Bare clicks inside the contenteditable do nothing — that would steal the
 * cursor and is the wrong default for an editor. Cmd/Ctrl-click follows the
 * link, matching Obsidian and Tolaria.
 */
export function useLinkActivation(host: React.RefObject<HTMLElement | null>) {
  const notes = useVaultNotes()
  // Stash the latest note list in a ref so the listener doesn't need to
  // re-attach when the vault tree updates (and lose the click in flight).
  const notesRef = useRef<VaultNote[]>(notes)
  notesRef.current = notes

  useEffect(() => {
    const el = host.current
    if (!el) return

    function onClick(e: MouseEvent) {
      const target = e.target as HTMLElement | null
      if (!target) return
      // Only follow on modifier-click inside a contenteditable surface.
      // Outside an editable area (e.g. rendered preview) a bare click works.
      const inEditable =
        target.closest('[contenteditable="true"], .ProseMirror, .cm-content') !== null
      const modifier = e.metaKey || e.ctrlKey
      if (inEditable && !modifier) return

      const wikilink = target.closest<HTMLElement>('.wikilink[data-target]')
      if (wikilink) {
        const raw = wikilink.getAttribute("data-target") || ""
        navigate(raw, notesRef.current)
        e.preventDefault()
        e.stopPropagation()
        return
      }
      const anchor = target.closest<HTMLAnchorElement>("a[href]")
      if (anchor) {
        const href = anchor.getAttribute("href") || ""
        if (!isInternalHref(href)) return
        navigate(decodeTarget(href), notesRef.current)
        e.preventDefault()
        e.stopPropagation()
      }
    }

    // Capture phase so we run before BlockNote's link toolbar or the
    // ProseMirror link plugin can swallow the event.
    el.addEventListener("click", onClick, true)
    el.addEventListener("mousedown", onClick, true)
    return () => {
      el.removeEventListener("click", onClick, true)
      el.removeEventListener("mousedown", onClick, true)
    }
  }, [host])
}

function navigate(rawTarget: string, notes: VaultNote[]) {
  const resolved = resolveLinkTarget(rawTarget, notes)
  if (!resolved) return
  // Same pipeline used by the tree and the command palette: setting the
  // selected path triggers useOpenFile to load the doc.
  useStore.getState().setSelected(resolved.path)
}
