import { copyFile, mkdir, readdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { appDataDir } from '@jsuite/data'

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

/** Remove media files no longer referenced by the document's blocks. */
export async function pruneMedia(docKey: string, keepNames: string[]): Promise<void> {
  const dir = mediaDir(docKey)
  if (!existsSync(dir)) return
  const keep = new Set(keepNames.map(sanitizeMediaName))
  for (const f of await readdir(dir)) {
    if (!keep.has(f)) await rm(join(dir, f), { force: true })
  }
}
