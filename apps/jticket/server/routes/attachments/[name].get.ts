import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// Serves uploaded doc attachments from .data/attachments/.
export default defineEventHandler((event) => {
  const name = safeAttachmentName(getRouterParam(event, 'name') ?? '')
  const file = join(ATTACHMENTS_DIR, name)
  if (!existsSync(file)) throw createError({ statusCode: 404, statusMessage: 'attachment not found' })
  setHeader(event, 'content-type', attachmentMime(name))
  setHeader(event, 'cache-control', 'no-cache')
  return readFileSync(file)
})
