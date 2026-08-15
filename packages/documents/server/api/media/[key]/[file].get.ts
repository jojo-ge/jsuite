import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'

// Serves the image bytes an `image` block points at. Both path segments are
// sanitised before they touch the filesystem, so a crafted URL can't escape the
// document's own media directory.
export default defineEventHandler(async (event) => {
  const key = sanitizeDocKey(getRouterParam(event, 'key'))
  const name = sanitizeMediaName(getRouterParam(event, 'file') ?? '')
  const path = mediaPath(key, name)

  if (!key || !existsSync(path)) {
    throw createError({ statusCode: 404, statusMessage: 'image not found' })
  }

  setHeader(event, 'Content-Type', mediaContentType(name))
  setHeader(event, 'Cache-Control', 'no-cache')
  return await readFile(path)
})
