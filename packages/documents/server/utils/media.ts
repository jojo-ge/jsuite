import { copyFile, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { appDataDir } from '@jsuite/data'
import { sanitizeDocKey } from './store'

// Image blocks carry bytes, not text, so they can't live inside the document
// JSON like every other block's payload. Instead each document gets a media
// directory beside it — .data/jexplain/media/<docKey>/ — and the stored block
// keeps only a served URL into it. Same principle as chart blocks keeping a
// chartKey: the document references, the store owns.
const MEDIA_ROOT = join(appDataDir('jexplain'), 'media')

const EXT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
}

export function isSupportedImage(path: string): boolean {
  return extname(path).toLowerCase() in EXT_TYPES
}

export function mediaContentType(name: string): string {
  return EXT_TYPES[extname(name).toLowerCase()] ?? 'application/octet-stream'
}

export function mediaDir(docKey: string): string {
  return join(MEDIA_ROOT, sanitizeDocKey(docKey))
}

/** Safe filename: no directories, no traversal, keeps the extension. */
export function sanitizeMediaName(name: string): string {
  const ext = extname(name).toLowerCase()
  const stem = basename(name, extname(name))
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return (stem || 'image') + (ext in EXT_TYPES ? ext : '.png')
}

export function mediaPath(docKey: string, name: string): string {
  return join(mediaDir(docKey), sanitizeMediaName(name))
}

/**
 * Copy a local image file into the document's media dir and return the URL the
 * renderer should use. Copying (rather than referencing the original path) means
 * the document keeps working after the source tree moves or is cleaned up.
 */
export async function storeMedia(docKey: string, sourcePath: string, preferredName?: string): Promise<string> {
  if (!existsSync(sourcePath)) throw new Error(`image file not found: ${sourcePath}`)
  const key = sanitizeDocKey(docKey)
  const name = sanitizeMediaName(preferredName || basename(sourcePath))
  await mkdir(mediaDir(key), { recursive: true })
  await copyFile(sourcePath, join(mediaDir(key), name))
  return `/api/media/${key}/${name}`
}

/** Largest image the inline (base64) paths accept, decoded. */
export const MAX_MEDIA_BYTES = 12 * 1024 * 1024

/**
 * Decode an inline image — a data: URL or bare base64 — into bytes plus the
 * extension its content type implies ('' when the payload carried none, i.e.
 * bare base64; the caller falls back to the name's extension, then .png).
 */
export function decodeInlineImage(payload: string): { bytes: Buffer; ext: string } {
  const trimmed = payload.trim()
  const m = /^data:([a-z0-9.+/-]+);base64,(.+)$/is.exec(trimmed)
  let ext = ''
  let b64 = trimmed
  if (m) {
    const type = m[1]!.toLowerCase()
    ext = Object.entries(EXT_TYPES).find(([, t]) => t === type)?.[0] ?? ''
    if (!ext) throw new Error(`unsupported image type: ${type}`)
    b64 = m[2]!
  } else if (/^data:/i.test(trimmed)) {
    throw new Error('expected a base64 image data URL')
  }
  const bytes = Buffer.from(b64.replace(/\s+/g, ''), 'base64')
  if (!bytes.length) throw new Error('empty image payload')
  if (bytes.length > MAX_MEDIA_BYTES) throw new Error('image too large (max 12MB)')
  return { bytes, ext }
}

/**
 * Store inline image bytes (a data: URL or bare base64) as block media and
 * return the served URL — the upload path for clients that can't hand us a
 * local file: a browser paste, or a skill on another machine. `preferredName`
 * decides the stored name; its extension wins over the data URL's type only
 * when the payload was bare base64.
 */
export async function storeMediaBytes(docKey: string, payload: string, preferredName?: string): Promise<string> {
  const { bytes, ext } = decodeInlineImage(payload)
  const key = sanitizeDocKey(docKey)
  const stem = basename(preferredName || 'image', extname(preferredName || ''))
  const nameExt = extname(preferredName || '').toLowerCase()
  const name = sanitizeMediaName(stem + (ext || (nameExt in EXT_TYPES ? nameExt : '.png')))
  await mkdir(mediaDir(key), { recursive: true })
  await writeFile(join(mediaDir(key), name), bytes)
  return `/api/media/${key}/${name}`
}

/**
 * Note attachments live in a `notes/` subdirectory of the document's media dir.
 * Keeping them out of the top level means republishing the document (which
 * prunes block media) can never delete the reviewer's pictures.
 */
export function notesMediaDir(docKey: string): string {
  return join(mediaDir(docKey), 'notes')
}

export function notesMediaPath(docKey: string, name: string): string {
  return join(notesMediaDir(docKey), sanitizeMediaName(name))
}

/** Store a data: URL (a paste, an upload, or a canvas export) as a note attachment. */
export async function storeNoteMedia(docKey: string, dataUrl: string, preferredName?: string): Promise<string> {
  if (!/^data:/i.test(dataUrl.trim())) throw new Error('expected a base64 image data URL')
  const { bytes, ext } = decodeInlineImage(dataUrl)
  const key = sanitizeDocKey(docKey)
  const name = sanitizeMediaName((preferredName || 'note') + (ext || '.png'))
  await mkdir(notesMediaDir(key), { recursive: true })
  await writeFile(join(notesMediaDir(key), name), bytes)
  return `/api/media/${key}/notes/${name}`
}

/**
 * Remove media files no longer referenced by the document's blocks. Only touches
 * files in the top level — subdirectories (i.e. note attachments) are left alone.
 */
export async function pruneMedia(docKey: string, keepNames: string[]): Promise<void> {
  const dir = mediaDir(docKey)
  if (!existsSync(dir)) return
  const keep = new Set(keepNames.map(sanitizeMediaName))
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) continue
    if (!keep.has(entry.name)) await rm(join(dir, entry.name), { force: true })
  }
}
