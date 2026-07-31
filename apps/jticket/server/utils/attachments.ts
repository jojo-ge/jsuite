import { extname, basename } from 'node:path'
import { appDataFile } from '@jsuite/data'

// Attachments live next to the store, in <monorepo root>/.data/jticket/attachments/.
export const ATTACHMENTS_DIR = appDataFile('jticket', 'attachments')

// Strip anything path-like or shell-unfriendly from a client-supplied name.
export function safeAttachmentName(raw: string): string {
  const name = basename(String(raw)).replace(/[^\w.-]+/g, '-').replace(/^[-.]+/, '')
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
