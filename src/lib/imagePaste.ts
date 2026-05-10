import { ipc } from "./ipc"
import type { ImagesLocation } from "./store"

const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/avif": "avif",
  "image/bmp": "bmp",
}

const EXT_TO_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  avif: "image/avif",
  bmp: "image/bmp",
}

const DEFAULT_TEMPLATE = "{date}-{time}-{rand}"

// Characters illegal in filenames on at least one major OS: path
// separators, the Windows reserved set, NUL, and control chars.
// eslint-disable-next-line no-control-regex
const ILLEGAL_CHARS = /[<>:"/\\|?*\x00-\x1f]/g

const MAX_ATTEMPTS = 4

export function mimeToExt(mime: string): string | null {
  return MIME_TO_EXT[mime.toLowerCase()] ?? null
}

export function guessMimeFromName(name: string): string | null {
  const dot = name.lastIndexOf(".")
  if (dot < 0) return null
  const ext = name.slice(dot + 1).toLowerCase()
  return EXT_TO_MIME[ext] ?? null
}

function detectSep(p: string): "/" | "\\" {
  return p.includes("\\") && !p.includes("/") ? "\\" : "/"
}

function parentDir(p: string): string {
  const idx = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"))
  return idx <= 0 ? "" : p.slice(0, idx)
}

function joinPath(a: string, b: string): string {
  const sep = detectSep(a)
  return a.endsWith(sep) ? a + b : a + sep + b
}

function fileStem(p: string): string {
  const name = p.split(/[\\/]/).pop() ?? ""
  const dot = name.lastIndexOf(".")
  return dot <= 0 ? name : name.slice(0, dot)
}

function splitSegments(p: string): string[] {
  return p.split(/[\\/]/).filter(Boolean)
}

export function resolveImageDir(
  vaultRoot: string,
  docPath: string,
  location: ImagesLocation,
): string {
  switch (location) {
    case "vault-assets":
      return joinPath(vaultRoot, "assets")
    case "sibling-assets":
      return joinPath(parentDir(docPath), `${fileStem(docPath)}.assets`)
    case "same-folder":
      return parentDir(docPath)
  }
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`
}

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function formatTime(d: Date): string {
  return `${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`
}

function randHex(): string {
  // 4 hex chars = 16 bits of entropy. Plenty for collision avoidance
  // when combined with a timestamp.
  const bytes = new Uint8Array(2)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

function sanitizeForFilename(s: string): string {
  return s.replace(ILLEGAL_CHARS, "")
}

export function generateFilename(
  mime: string,
  template: string,
  ctx: { docPath: string; now?: Date; rand?: () => string },
): string {
  const ext = mimeToExt(mime)
  if (!ext) throw new Error(`unsupported image MIME: ${mime}`)

  const now = ctx.now ?? new Date()
  const rand = ctx.rand ?? randHex

  function expand(tmpl: string): string {
    return tmpl.replace(/\{(date|time|rand|note)\}/g, (match, tok) => {
      if (tok === "date") return formatDate(now)
      if (tok === "time") return formatTime(now)
      if (tok === "rand") return rand()
      if (tok === "note") return slugify(fileStem(ctx.docPath))
      return match
    })
  }

  let stem = sanitizeForFilename(expand(template))
  if (!stem) stem = sanitizeForFilename(expand(DEFAULT_TEMPLATE))
  return `${stem}.${ext}`
}

export function relativeFromDocDir(docPath: string, absolutePath: string): string {
  const fromSegs = splitSegments(parentDir(docPath))
  const toSegs = splitSegments(absolutePath)
  let i = 0
  while (i < fromSegs.length && i < toSegs.length && fromSegs[i] === toSegs[i]) i++
  const up = Array(fromSegs.length - i).fill("..")
  return [...up, ...toSegs.slice(i)].join("/")
}

export type SaveImageInput = {
  bytes: Uint8Array
  mime: string
  vaultRoot: string
  docPath: string
  location: ImagesLocation
  template: string
  now?: Date
  rand?: () => string
}

export type SaveImageResult = {
  absolutePath: string
  relativePath: string
}

function isAlreadyExistsError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false
  const msg = (e as { message?: unknown }).message
  return typeof msg === "string" && msg.startsWith("already exists:")
}

function withSuffix(filename: string, suffix: string): string {
  if (!suffix) return filename
  const dot = filename.lastIndexOf(".")
  if (dot <= 0) return `${filename}${suffix}`
  return `${filename.slice(0, dot)}${suffix}${filename.slice(dot)}`
}

export async function saveImage(input: SaveImageInput): Promise<SaveImageResult> {
  if (!mimeToExt(input.mime)) {
    throw new Error(`unsupported image MIME: ${input.mime}`)
  }
  const dir = resolveImageDir(input.vaultRoot, input.docPath, input.location)
  const baseFilename = generateFilename(input.mime, input.template, {
    docPath: input.docPath,
    now: input.now,
    rand: input.rand,
  })

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const suffix = attempt === 0 ? "" : `-${attempt}`
    const absolutePath = joinPath(dir, withSuffix(baseFilename, suffix))
    try {
      await ipc.writeImage(absolutePath, input.bytes)
      return {
        absolutePath,
        relativePath: relativeFromDocDir(input.docPath, absolutePath),
      }
    } catch (e) {
      if (!isAlreadyExistsError(e)) throw e
    }
  }
  throw new Error("Couldn't pick a unique filename — try again")
}
