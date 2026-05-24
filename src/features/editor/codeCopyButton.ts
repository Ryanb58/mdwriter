import { writeText } from "@tauri-apps/plugin-clipboard-manager"

/**
 * BlockNote's `codeBlock` renders as `<div data-content-type="codeBlock">`
 * with a language `<select>` (top-left) and a `<pre><code>` body. We sit
 * outside the schema and decorate the rendered DOM with a top-right
 * Copy button, so syntax highlighting stays handled by the published
 * `@blocknote/code-block` spec.
 *
 * A MutationObserver picks up blocks added by typing/pasting and by
 * BlockNote's ProseMirror reflows. We mark each block with a sentinel
 * attribute so re-decoration is a no-op.
 *
 * Returns a teardown that disconnects the observer.
 */
const INSTALLED_ATTR = "data-copy-button-installed"
const BLOCK_SELECTOR = '[data-content-type="codeBlock"]'

export function installCodeCopyButtons(host: HTMLElement): () => void {
  const observer = new MutationObserver(() => decorate(host))
  observer.observe(host, { childList: true, subtree: true })
  decorate(host)
  return () => observer.disconnect()
}

function decorate(host: HTMLElement) {
  host.querySelectorAll<HTMLElement>(BLOCK_SELECTOR).forEach(installButton)
}

function installButton(block: HTMLElement) {
  if (block.hasAttribute(INSTALLED_ATTR)) return
  block.setAttribute(INSTALLED_ATTR, "")
  // BlockNote's block wrapper is `position: relative` already in most layouts,
  // but the codeBlock data-content-type lives on a nested div. Make sure our
  // absolute-positioned button has a positioned ancestor.
  if (getComputedStyle(block).position === "static") {
    block.style.position = "relative"
  }

  const btn = document.createElement("button")
  btn.type = "button"
  btn.textContent = "Copy"
  btn.className = "code-copy-button"
  // Without contenteditable=false ProseMirror treats clicks inside as
  // selection changes against the codeBlock node.
  btn.contentEditable = "false"
  btn.setAttribute("aria-label", "Copy code")
  btn.addEventListener("mousedown", (e) => {
    // Prevent ProseMirror from stealing focus before the click fires.
    e.preventDefault()
  })
  btn.addEventListener("click", async (e) => {
    e.preventDefault()
    e.stopPropagation()
    const code = block.querySelector("pre > code")
    const text = code?.textContent ?? ""
    await copyToClipboard(text)
    flashCopied(btn)
  })
  block.appendChild(btn)
}

async function copyToClipboard(text: string): Promise<void> {
  try {
    await writeText(text)
    return
  } catch {
    // Fallback for browser-only dev (no Tauri runtime). navigator.clipboard
    // requires a secure context but localhost qualifies.
  }
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    // Last resort: nothing we can do silently. Swallow — the user will
    // notice the missing "Copied" feedback and retry.
  }
}

function flashCopied(btn: HTMLButtonElement) {
  btn.textContent = "Copied"
  btn.classList.add("code-copy-button--copied")
  window.setTimeout(() => {
    btn.textContent = "Copy"
    btn.classList.remove("code-copy-button--copied")
  }, 1200)
}
