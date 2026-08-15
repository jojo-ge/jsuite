import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'

// Serves a note attachment. Kept in its own `notes/` subdirectory so that
// republishing a document (which prunes block media) never deletes a reviewer's
// pictures. Both segments are sanitised before touching the filesystem.
export default defineEventHandler(async (event) => {
  const key = sanitizeDocKey(getRouterParam(event, 'key'))
  const name = sanitizeMediaName(getRouterParam(event, 'file') ?? '')
  const path = notesMediaPath(key, name)

  if (!key || !existsSync(path)) {
    throw createError({ statusCode: 404, statusMessage: 'image not found' })
  }

  setHeader(event, 'Content-Type', mediaContentType(name))
  setHeader(event, 'Cache-Control', 'no-cache')
  return await readFile(path)
})
