import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Upload an attachment (images etc.) for anything that renders markdown —
// ticket descriptions, resolutions, comments, project descriptions. Body is
// one of:
//   { name, base64 }   bare base64 or a data: URL (`dataUrl` is a synonym)
//   { file, name? }    absolute path on this machine; name defaults to its own
// Same name overwrites. The file is served at /attachments/<name>; the
// response's `markdown` is ready to paste into a body: ![name](/attachments/<name>)
export default defineEventHandler(async (event) => {
  const body = (await readBody<AttachmentPayload>(event)) ?? {}
  let decoded: { name: string; buf: Buffer }
  try {
    decoded = decodeAttachmentPayload(body)
  } catch (err) {
    throw createError({ statusCode: 400, statusMessage: (err as Error).message })
  }
  const { name, buf } = decoded

  mkdirSync(ATTACHMENTS_DIR, { recursive: true })
  writeFileSync(join(ATTACHMENTS_DIR, name), buf)
  setResponseStatus(event, 201)
  return { name, url: `/attachments/${name}`, size: buf.length, markdown: attachmentMarkdown(name) }
})
