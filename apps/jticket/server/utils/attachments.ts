import { existsSync, readFileSync } from 'node:fs'
import { basename, extname } from 'node:path'
import { appDataFile } from '@jsuite/data'
import { sanitizeAttachmentName } from './bundle'

// Attachments live next to the store, in <monorepo root>/.data/jticket/attachments/.
export const ATTACHMENTS_DIR = appDataFile('jticket', 'attachments')

// Strip anything path-like or shell-unfriendly from a client-supplied name.
export function safeAttachmentName(raw: string): string {
  const name = sanitizeAttachmentName(raw)
  if (!name) throw createError({ statusCode: 400, statusMessage: 'invalid attachment name' })
  return name
}

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.json': 'application/json',
}

export function attachmentMime(name: string): string {
  return MIME[extname(name).toLowerCase()] ?? 'application/octet-stream'
}

/** Largest attachment the upload endpoint accepts. */
export const MAX_ATTACHMENT_BYTES = 12 * 1024 * 1024

export interface AttachmentPayload {
  name?: unknown
  /** Bare base64 or a data: URL. */
  base64?: unknown
  /** Synonym for `base64` — what a browser paste hands over. */
  dataUrl?: unknown
  /** Absolute path to a file on this machine (skills running locally). */
  file?: unknown
}

/**
 * Turn an upload body into bytes + the name to store them under. Three ways
 * in: inline `base64`/`dataUrl` (browser pastes, remote clients) or a local
 * `file` path (a skill that already has the screenshot on disk). `name`
 * defaults to the file's own name; inline payloads must name themselves.
 * Throws plain Errors — the handler maps them to 400s.
 */
export function decodeAttachmentPayload(body: AttachmentPayload): { name: string; buf: Buffer } {
  const inline =
    typeof body.base64 === 'string' && body.base64.trim()
      ? body.base64
      : typeof body.dataUrl === 'string' && body.dataUrl.trim()
        ? body.dataUrl
        : ''
  const file = typeof body.file === 'string' ? body.file.trim() : ''
  const rawName = typeof body.name === 'string' ? body.name.trim() : ''

  let buf: Buffer
  let name: string
  if (file) {
    if (!existsSync(file)) throw new Error(`file not found: ${file}`)
    buf = readFileSync(file)
    name = sanitizeAttachmentName(rawName || basename(file))
  } else if (inline) {
    if (!rawName) throw new Error('name is required with base64')
    const data = inline.trim().replace(/^data:[^;]+;base64,/i, '')
    if (/^data:/i.test(data)) throw new Error('expected a base64 data: URL')
    buf = Buffer.from(data.replace(/\s+/g, ''), 'base64')
    name = sanitizeAttachmentName(rawName)
  } else {
    throw new Error('base64 (or dataUrl) or file is required')
  }
  if (!name) throw new Error('invalid attachment name')
  if (!buf.length) throw new Error('empty attachment')
  if (buf.length > MAX_ATTACHMENT_BYTES) throw new Error('attachment too large (max 12MB)')
  return { name, buf }
}

/** The markdown that embeds (images) or links (anything else) an attachment. */
export function attachmentMarkdown(name: string): string {
  const url = `/attachments/${name}`
  return attachmentMime(name).startsWith('image/') ? `![${name}](${url})` : `[${name}](${url})`
}
