import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// List every uploaded file. Legacy alias: GET /api/attachments redirects here.
export default defineEventHandler(() => {
  if (!existsSync(UPLOADS_DIR)) return []
  return readdirSync(UPLOADS_DIR)
    .filter((f) => !f.startsWith('.'))
    .map((name) => ({
      name,
      url: `/uploads/${name}`,
      size: statSync(join(UPLOADS_DIR, name)).size,
    }))
})
