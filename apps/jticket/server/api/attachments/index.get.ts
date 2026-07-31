import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

export default defineEventHandler(() => {
  if (!existsSync(ATTACHMENTS_DIR)) return []
  return readdirSync(ATTACHMENTS_DIR)
    .filter((f) => !f.startsWith('.'))
    .map((name) => ({
      name,
      url: `/attachments/${name}`,
      size: statSync(join(ATTACHMENTS_DIR, name)).size,
    }))
})
