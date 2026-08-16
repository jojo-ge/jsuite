import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Upload a FILE (images etc.) for use in markdown: { name, base64 }. Unrelated
// to the artifact attachments on tickets and projects, which are refs into the
// shared pools and live at /api/{tickets,projects}/:id/attachments.
// `base64` may be a bare base64 string or a data: URL. Same name overwrites.
// The file becomes available at /uploads/<name>, ready for markdown:
// ![alt](/uploads/<name>)
// Legacy alias: POST /api/attachments redirects here (308, method preserved).
export default defineEventHandler(async (event) => {
  const body = await readBody<{ name?: string; base64?: string }>(event)
  if (!body?.name || !body?.base64) {
    throw createError({ statusCode: 400, statusMessage: 'name and base64 are required' })
  }
  const name = safeUploadName(body.name)
  const data = body.base64.replace(/^data:[^;]+;base64,/, '')

  let buf: Buffer
  try {
    buf = Buffer.from(data, 'base64')
  } catch {
    throw createError({ statusCode: 400, statusMessage: 'invalid base64 payload' })
  }
  if (!buf.length) throw createError({ statusCode: 400, statusMessage: 'empty upload' })

  mkdirSync(UPLOADS_DIR, { recursive: true })
  writeFileSync(join(UPLOADS_DIR, name), buf)
  setCreated(event)
  return { name, url: `/uploads/${name}`, size: buf.length }
})
