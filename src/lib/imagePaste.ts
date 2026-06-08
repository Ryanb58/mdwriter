import { readImage } from "@tauri-apps/plugin-clipboard-manager"
import { ipc } from "./ipc"
import { basename, joinPath, parent } from "./paths"
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

// Path separators, Windows reserved set, NUL, and control chars —
// illegal on at least one major OS.
// eslint-disable-next-line no-control-regex
const ILLEGAL_CHARS = /[<>:"/\\|?*\x00-\x1f]/g

const MAX_ATTEMPTS = 4

// Guard the base64 round-trip (FileReader.readAsDataURL → invoke). Pasted
// screenshots are well under this; anything larger is almost certainly a
// mistake (or a hostile clipboard) and would stall the JSON IPC.
export const MAX_IMAGE_BYTES = 64 * 1024 * 1024 // 64 MiB

// A decoded RGBA buffer must be exactly width * height * 4 bytes. A canvas
// this large would also exhaust memory during PNG re-encode, so cap the
// pixel count before we allocate.
const MAX_IMAGE_PIXELS = 64 * 1024 * 1024 // 64 megapixels

export function mimeToExt(mime: string): string | null {
  return MIME_TO_EXT[mime.toLowerCase()] ?? null
}

export function guessMimeFromName(name: string): string | null {
  const dot = name.lastIndexOf(".")
  if (dot < 0) return null
  const ext = name.slice(dot + 1).toLowerCase()
  return EXT_TO_MIME[ext] ?? null
}

function fileStem(p: string): string {
  const name = basename(p)
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
    case "same-folder":
      return parent(docPath)
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
  // 4 hex chars = 16 bits of entropy. Enough when combined with a timestamp.
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

// Percent-encode characters that have special meaning inside the
// `![](url)` form: whitespace, parens, square brackets, and angle
// brackets. Path separators stay as-is so the URL remains readable.
export function encodeMarkdownUrl(path: string): string {
  return path.replace(/[\s()[\]<>]/g, (c) =>
    `%${c.charCodeAt(0).toString(16).padStart(2, "0").toUpperCase()}`,
  )
}

export function relativeFromDocDir(docPath: string, absolutePath: string): string {
  const fromSegs = splitSegments(parent(docPath))
  const toSegs = splitSegments(absolutePath)
  let i = 0
  while (i < fromSegs.length && i < toSegs.length && fromSegs[i] === toSegs[i]) i++
  const up = Array(fromSegs.length - i).fill("..")
  return [...up, ...toSegs.slice(i)].join("/")
}

export function resolveAgainstDocDir(docPath: string, rel: string): string {
  if (rel.startsWith("/") || /^[A-Za-z]:[\\/]/.test(rel)) return rel
  const sep = docPath.includes("\\") ? "\\" : "/"
  const segs = [...splitSegments(parent(docPath)), ...rel.split("/").filter(Boolean)]
  const stack: string[] = []
  for (const s of segs) {
    if (s === "..") stack.pop()
    else if (s !== ".") stack.push(s)
  }
  const prefix = docPath.startsWith("/") ? "/" : ""
  return prefix + stack.join(sep)
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
  if (!input.bytes || input.bytes.length === 0) {
    throw new Error("Refusing to save an empty image")
  }
  if (input.bytes.length > MAX_IMAGE_BYTES) {
    const mb = (input.bytes.length / (1024 * 1024)).toFixed(1)
    throw new Error(`Image is too large to paste (${mb} MB)`)
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

// WKWebView on macOS reports `types: ["Files"]` for pasted images but
// keeps `items`/`files` empty, so BlockNote's paste plugin can't fire
// uploadFile. Read the image natively through the clipboard-manager
// plugin instead and encode RGBA → PNG via canvas so the rest of the
// pipeline (saveImage / BlockNote) gets a normal PNG Blob.
//
// Returns `null` only when the clipboard genuinely holds no image (nothing
// to paste). Any *failure* to read or re-encode an image that is present is
// surfaced as a thrown Error so the caller can report it instead of silently
// dropping the paste.
export async function readClipboardImageAsPng(): Promise<Uint8Array | null> {
  let image: Awaited<ReturnType<typeof readImage>>
  try {
    image = await readImage()
  } catch {
    // No image on the clipboard, or the plugin couldn't read one. Treat as
    // "nothing to paste" rather than an error — the user may have copied text.
    return null
  }

  let rgba: Awaited<ReturnType<typeof image.rgba>>
  let size: Awaited<ReturnType<typeof image.size>>
  try {
    ;[rgba, size] = await Promise.all([image.rgba(), image.size()])
  } catch (e) {
    throw new Error(
      `Failed to read clipboard image data: ${e instanceof Error ? e.message : String(e)}`,
    )
  }

  if (!size.width || !size.height) return null
  if (size.width < 0 || size.height < 0) {
    throw new Error("Clipboard image has invalid dimensions")
  }
  if (size.width * size.height > MAX_IMAGE_PIXELS) {
    throw new Error("Clipboard image is too large to paste")
  }

  // A well-formed RGBA buffer is exactly 4 bytes per pixel. A mismatch means
  // the native read handed us a truncated/garbage buffer — bail loudly rather
  // than writing a corrupt PNG.
  const expectedLen = size.width * size.height * 4
  const rgbaBytes = new Uint8ClampedArray(rgba)
  if (rgbaBytes.length === 0) return null
  if (rgbaBytes.length !== expectedLen) {
    throw new Error(
      `Clipboard image data is malformed (got ${rgbaBytes.length} bytes, expected ${expectedLen})`,
    )
  }

  const canvas = document.createElement("canvas")
  canvas.width = size.width
  canvas.height = size.height
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("Couldn't get a 2D canvas context to encode the image")
  const imageData = ctx.createImageData(size.width, size.height)
  imageData.data.set(rgbaBytes)
  ctx.putImageData(imageData, 0, 0)

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/png"),
  )
  if (!blob) throw new Error("Couldn't re-encode the clipboard image as PNG")
  const out = new Uint8Array(await blob.arrayBuffer())
  if (out.length === 0) throw new Error("PNG re-encode produced no data")
  return out
}
