import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Upload an attachment (images etc.) for use in docs: { name, base64 }.
// `base64` may be a bare base64 string or a data: URL. Same name overwrites.
// The file becomes available at /attachments/<name>, ready for markdown:
// ![alt](/attachments/<name>)
export default defineEventHandler(async (event) => {
  const body = await readBody<{ name?: string; base64?: string }>(event)
  if (!body?.name || !body?.base64) {
    throw createError({ statusCode: 400, statusMessage: 'name and base64 are required' })
  }
  const name = safeAttachmentName(body.name)
  const data = body.base64.replace(/^data:[^;]+;base64,/, '')

  let buf: Buffer
  try {
    buf = Buffer.from(data, 'base64')
  } catch {
    throw createError({ statusCode: 400, statusMessage: 'invalid base64 payload' })
  }
  if (!buf.length) throw createError({ statusCode: 400, statusMessage: 'empty attachment' })

  mkdirSync(ATTACHMENTS_DIR, { recursive: true })
  writeFileSync(join(ATTACHMENTS_DIR, name), buf)
  setCreated(event)
  return { name, url: `/attachments/${name}`, size: buf.length }
})
