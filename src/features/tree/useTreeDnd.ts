import { useEffect, useRef, useState } from "react"
import type { TreeNode as TN } from "../../lib/ipc"
import { useStore } from "../../lib/store"
import { parent } from "../../lib/paths"
import { useDndStore, INTERNAL_DRAG_MIME } from "./dndStore"
import { moveItems } from "./moveExecutor"
import { importDroppedFiles } from "./importExecutor"
import { requestConfirm } from "./dndPrompts"

const AUTO_EXPAND_MS = 600

/**
 * Decide whether `target` (a folder absolute path; the vault root uses
 * its full rootPath, not "") is a legal destination for an internal drag
 * of `sources`. Rejects:
 *   - dropping a folder onto itself
 *   - dropping a folder into any of its descendants
 *
 * Same-parent drops are deliberately allowed here so the drop UI still
 * highlights; `handleInternalDrop` short-circuits them as no-ops.
 */
function isLegalInternalDrop(sources: string[], target: string): boolean {
  if (sources.length === 0) return false
  for (const src of sources) {
    if (src === target) return false
    // Descendant check via prefix on both separators. We deliberately
    // allow same-parent drops to show drop UI — the executor short-circuits
    // them as no-ops afterward.
    if (target.startsWith(src + "/") || target.startsWith(src + "\\")) {
      return false
    }
  }
  return true
}

function dataTransferHasInternalDrag(dt: DataTransfer): boolean {
  return Array.from(dt.types).includes(INTERNAL_DRAG_MIME)
}

function dataTransferHasFiles(dt: DataTransfer): boolean {
  return Array.from(dt.types).includes("Files")
}

function readInternalSources(dt: DataTransfer): string[] {
  try {
    const raw = dt.getData(INTERNAL_DRAG_MIME)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : []
  } catch {
    return []
  }
}

/**
 * Build a small canvas drag preview: first row name + "+N more" badge
 * when the user is dragging multiple items. Returns the HTMLCanvasElement
 * so the caller can pass it to setDragImage and clean it up on dragend.
 */
function buildDragPreview(firstName: string, extra: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas")
  const ctx = canvas.getContext("2d")
  const dpr = window.devicePixelRatio || 1
  const padX = 10
  const padY = 6
  const fontSize = 13
  ctx!.font = `500 ${fontSize}px ui-sans-serif, system-ui, -apple-system`
  const labelW = ctx!.measureText(firstName).width
  const badge = extra > 0 ? `+${extra}` : ""
  const badgeW = badge ? ctx!.measureText(badge).width + 12 : 0
  const w = Math.ceil(padX * 2 + labelW + (badge ? 8 + badgeW : 0))
  const h = fontSize + padY * 2
  canvas.width = w * dpr
  canvas.height = h * dpr
  canvas.style.width = `${w}px`
  canvas.style.height = `${h}px`
  ctx!.scale(dpr, dpr)

  // Background pill.
  ctx!.fillStyle = "rgba(30, 30, 32, 0.95)"
  const r = 6
  ctx!.beginPath()
  ctx!.moveTo(r, 0)
  ctx!.lineTo(w - r, 0)
  ctx!.quadraticCurveTo(w, 0, w, r)
  ctx!.lineTo(w, h - r)
  ctx!.quadraticCurveTo(w, h, w - r, h)
  ctx!.lineTo(r, h)
  ctx!.quadraticCurveTo(0, h, 0, h - r)
  ctx!.lineTo(0, r)
  ctx!.quadraticCurveTo(0, 0, r, 0)
  ctx!.closePath()
  ctx!.fill()

  ctx!.fillStyle = "#f5f5f7"
  ctx!.font = `500 ${fontSize}px ui-sans-serif, system-ui, -apple-system`
  ctx!.textBaseline = "middle"
  ctx!.fillText(firstName, padX, h / 2)

  if (badge) {
    const x = padX + labelW + 8
    ctx!.fillStyle = "rgba(120, 130, 255, 0.85)"
    ctx!.fillRect(x, h / 2 - 9, badgeW, 18)
    ctx!.fillStyle = "#fff"
    ctx!.fillText(badge, x + 6, h / 2)
  }

  return canvas
}

function basenameOf(p: string): string {
  const parts = p.split(/[/\\]/).filter(Boolean)
  return parts[parts.length - 1] ?? p
}

/**
 * Per-row DnD wiring. Drag handlers, drop targets, and the small bit of
 * UI state (drag image canvas) that has to live on the row itself.
 */
export function useRowDnd(node: TN) {
  const expandFolder = useStore((s) => s.toggleFolderExpanded)
  const dndSource = useDndStore((s) => s.source)
  const dropTargetPath = useDndStore((s) => s.dropTarget)
  const beginInternalDrag = useDndStore((s) => s.beginInternalDrag)
  const beginExternalDrag = useDndStore((s) => s.beginExternalDrag)
  const setDropTarget = useDndStore((s) => s.setDropTarget)
  const endDnd = useDndStore((s) => s.end)

  const previewCanvas = useRef<HTMLCanvasElement | null>(null)
  const autoExpandTimer = useRef<number | null>(null)
  const [overCount, setOverCount] = useState(0)

  // Cleanup on unmount: cancel pending timer.
  useEffect(() => () => {
    if (autoExpandTimer.current != null) window.clearTimeout(autoExpandTimer.current)
  }, [])

  const isDir = node.kind === "dir"
  const sourcePaths = dndSource && dndSource.kind === "internal" ? dndSource.paths : []
  const isDragging = sourcePaths.includes(node.path)
  const isDropTarget = isDir && dropTargetPath === node.path && overCount > 0

  function onDragStart(e: React.DragEvent) {
    const s = useStore.getState()
    let paths: string[]
    if (s.selectedPaths.has(node.path) && s.selectedPaths.size > 1) {
      paths = Array.from(s.selectedPaths)
    } else {
      paths = [node.path]
      // Collapse selection to the dragged row so the visual matches intent.
      s.setSelected(node.path)
    }
    e.dataTransfer.effectAllowed = "move"
    e.dataTransfer.setData(INTERNAL_DRAG_MIME, JSON.stringify(paths))
    beginInternalDrag(paths)

    const firstName = basenameOf(paths[0])
    const canvas = buildDragPreview(firstName, paths.length - 1)
    document.body.appendChild(canvas)
    canvas.style.position = "absolute"
    canvas.style.top = "-9999px"
    canvas.style.left = "-9999px"
    previewCanvas.current = canvas
    e.dataTransfer.setDragImage(canvas, 12, 12)
  }

  function onDragEnd(_e: React.DragEvent) {
    if (previewCanvas.current) {
      previewCanvas.current.remove()
      previewCanvas.current = null
    }
    if (autoExpandTimer.current != null) {
      window.clearTimeout(autoExpandTimer.current)
      autoExpandTimer.current = null
    }
    setOverCount(0)
    endDnd()
  }

  function onDragOver(e: React.DragEvent) {
    if (!isDir) return // files reject all drops
    const dt = e.dataTransfer

    if (dataTransferHasInternalDrag(dt)) {
      // Reading getData() is forbidden in dragover; rely on dndStore.
      const sources = useDndStore.getState().source
      const paths = sources && sources.kind === "internal" ? sources.paths : []
      if (!isLegalInternalDrop(paths, node.path)) {
        dt.dropEffect = "none"
        return
      }
      dt.dropEffect = "move"
    } else if (dataTransferHasFiles(dt)) {
      if (!useDndStore.getState().active) beginExternalDrag()
      dt.dropEffect = "copy"
    } else {
      return
    }

    e.preventDefault()
    e.stopPropagation()
    setDropTarget(node.path)
    if (overCount === 0) setOverCount(1)

    // Schedule auto-expand on first hover.
    if (autoExpandTimer.current == null) {
      const expanded = useStore.getState().expandedFolders.has(node.path)
      if (!expanded) {
        autoExpandTimer.current = window.setTimeout(() => {
          expandFolder(node.path, true)
          autoExpandTimer.current = null
        }, AUTO_EXPAND_MS)
      }
    }
  }

  function onDragLeave(_e: React.DragEvent) {
    if (!isDir) return
    setOverCount(0)
    if (autoExpandTimer.current != null) {
      window.clearTimeout(autoExpandTimer.current)
      autoExpandTimer.current = null
    }
    if (dropTargetPath === node.path) setDropTarget(null)
  }

  function onDrop(e: React.DragEvent) {
    if (!isDir) return
    e.preventDefault()
    e.stopPropagation()
    if (autoExpandTimer.current != null) {
      window.clearTimeout(autoExpandTimer.current)
      autoExpandTimer.current = null
    }

    const dt = e.dataTransfer
    // Snapshot drag payload BEFORE the synchronous endDnd(). DataTransfer
    // contents are only valid during the drop event itself, so copy
    // FileList into a real array.
    const sources = dataTransferHasInternalDrag(dt) ? readInternalSources(dt) : null
    const files = dataTransferHasFiles(dt) && dt.files.length > 0
      ? Array.from(dt.files)
      : null

    // External (Finder) drops never fire dragend, so we have to reset DnD
    // here. Do it synchronously — otherwise useDragScroll's RAF loop keeps
    // running while the import/collision modal is open.
    setOverCount(0)
    endDnd()

    if (sources) {
      handleInternalDrop(sources, node.path).catch(console.error)
    } else if (files) {
      importDroppedFiles(files, node.path).catch(console.error)
    }
  }

  return {
    isDragging,
    isDropTarget,
    onDragStart,
    onDragEnd,
    onDragOver,
    onDragLeave,
    onDrop,
  }
}

async function handleInternalDrop(sources: string[], targetDir: string): Promise<void> {
  if (sources.length === 0) return
  if (!isLegalInternalDrop(sources, targetDir)) return

  // Filter out any sources already in the target parent (no-op moves).
  const real = sources.filter((p) => parent(p) !== targetDir)
  if (real.length === 0) return

  if (real.length >= 3) {
    const ok = await requestConfirm({
      title: "Move multiple items",
      message: `Move ${real.length} items into "${basenameOf(targetDir) || targetDir}"?`,
      confirmLabel: "Move",
      cancelLabel: "Cancel",
      details: real.map(basenameOf),
    })
    if (!ok) return
  }

  await moveItems(real, targetDir)
}

/**
 * Hook for the empty space at the bottom of the tree — represents the
 * vault root as a drop target. Shares behavior with useRowDnd but has
 * no row to drag from.
 */
export function useRootDnd() {
  const rootPath = useStore((s) => s.rootPath)
  const dropTargetPath = useDndStore((s) => s.dropTarget)
  const beginExternalDrag = useDndStore((s) => s.beginExternalDrag)
  const setDropTarget = useDndStore((s) => s.setDropTarget)
  const endDnd = useDndStore((s) => s.end)
  const [overCount, setOverCount] = useState(0)

  const isDropTarget = rootPath !== null && dropTargetPath === rootPath && overCount > 0

  function onDragOver(e: React.DragEvent) {
    if (!rootPath) return
    const dt = e.dataTransfer

    if (dataTransferHasInternalDrag(dt)) {
      const sources = useDndStore.getState().source
      const paths = sources && sources.kind === "internal" ? sources.paths : []
      if (!isLegalInternalDrop(paths, rootPath)) {
        dt.dropEffect = "none"
        return
      }
      dt.dropEffect = "move"
    } else if (dataTransferHasFiles(dt)) {
      if (!useDndStore.getState().active) beginExternalDrag()
      dt.dropEffect = "copy"
    } else {
      return
    }

    e.preventDefault()
    setDropTarget(rootPath)
    if (overCount === 0) setOverCount(1)
  }

  function onDragLeave(_e: React.DragEvent) {
    setOverCount(0)
    if (dropTargetPath === rootPath) setDropTarget(null)
  }

  function onDrop(e: React.DragEvent) {
    if (!rootPath) return
    e.preventDefault()
    const dt = e.dataTransfer
    const sources = dataTransferHasInternalDrag(dt) ? readInternalSources(dt) : null
    const files = dataTransferHasFiles(dt) && dt.files.length > 0
      ? Array.from(dt.files)
      : null

    // Reset DnD synchronously — see useRowDnd.onDrop for the reasoning.
    setOverCount(0)
    endDnd()

    if (sources) {
      handleInternalDrop(sources, rootPath).catch(console.error)
    } else if (files) {
      importDroppedFiles(files, rootPath).catch(console.error)
    }
  }

  return { isDropTarget, onDragOver, onDragLeave, onDrop }
}
