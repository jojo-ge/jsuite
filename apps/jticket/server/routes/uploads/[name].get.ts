import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// Serves uploaded files from .data/jticket/attachments/.
// Legacy alias: /attachments/:name redirects here, which is what keeps the
// ![alt](/attachments/<name>) already written into stored markdown resolving.
export default defineEventHandler((event) => {
  const name = safeUploadName(getRouterParam(event, 'name') ?? '')
  const file = join(UPLOADS_DIR, name)
  if (!existsSync(file)) throw createError({ statusCode: 404, statusMessage: 'upload not found' })
  setHeader(event, 'content-type', uploadMime(name))
  setHeader(event, 'cache-control', 'no-cache')
  return readFileSync(file)
})
