import { useEffect } from "react"
import { useStore } from "../../lib/store"
import { fetchVaultNotes } from "../../lib/vaultNotes"
import {
  decodeTarget,
  isInternalHref,
  resolveLinkTarget,
} from "../../lib/wikilinkResolve"
import { isLinkActivationModifier } from "./linkAffordance"
import { revealPath } from "../tree/treeLoader"

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
      const modifier = isLinkActivationModifier(e)
      if (inEditable && !modifier) return

      const wikilink = target.closest<HTMLElement>('.wikilink[data-target]')
      if (wikilink) {
        const raw = wikilink.getAttribute("data-target") || ""
        void navigate(raw, wikilink)
        e.preventDefault()
        e.stopPropagation()
        return
      }
      const anchor = target.closest<HTMLAnchorElement>("a[href]")
      if (anchor) {
        const href = anchor.getAttribute("href") || ""
        if (!isInternalHref(href)) return
        void navigate(decodeTarget(href), anchor)
        e.preventDefault()
        e.stopPropagation()
      }
    }

    // Capture phase so we run before BlockNote's link toolbar or the
    // ProseMirror link plugin can swallow the event. Only `click` is
    // bound — a single user click also fires `mousedown`, so wiring
    // both would navigate twice.
    el.addEventListener("click", onClick, true)
    return () => {
      el.removeEventListener("click", onClick, true)
    }
  }, [host])
}

async function navigate(rawTarget: string, clicked: HTMLElement) {
  const root = useStore.getState().rootPath
  if (!root) return
  let notes
  try {
    notes = await fetchVaultNotes(root)
  } catch {
    return
  }
  if (useStore.getState().rootPath !== root) return
  const resolved = resolveLinkTarget(rawTarget, notes)
  if (!resolved) {
    clicked.classList.remove("wikilink--unknown", "wikilink--resolved")
    clicked.classList.add("wikilink--broken")
    return
  }
  clicked.classList.remove("wikilink--unknown", "wikilink--broken")
  clicked.classList.add("wikilink--resolved")
  // Same pipeline used by the tree and the command palette: setting the
  // selected path triggers useOpenFile to load the doc.
  useStore.getState().setSelected(resolved.path)
  void revealPath(resolved.path)
}
