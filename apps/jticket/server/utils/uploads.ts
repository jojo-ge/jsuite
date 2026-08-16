import { extname, basename } from 'node:path'
import { appDataFile } from '@jsuite/data'

// Uploaded FILES — images and the like, embedded in markdown as
// ![alt](/uploads/<name>). These used to hang off /api/attachments, one word
// away from a ticket's or project's `attachments`, which mean something else
// entirely: refs into the shared artifact pools (TICK-138). Two unrelated
// things under one word in one API is the collision this namespace undoes.
//
// The files themselves still live in <monorepo root>/.data/jticket/attachments/.
// The directory name is not part of the API and renaming it would strand every
// file on an existing install, so it stays put.
export const UPLOADS_DIR = appDataFile('jticket', 'attachments')

// Strip anything path-like or shell-unfriendly from a client-supplied name.
export function safeUploadName(raw: string): string {
  const name = basename(String(raw)).replace(/[^\w.-]+/g, '-').replace(/^[-.]+/, '')
  if (!name) throw createError({ statusCode: 400, statusMessage: 'invalid upload name' })
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

export function uploadMime(name: string): string {
  return MIME[extname(name).toLowerCase()] ?? 'application/octet-stream'
}
