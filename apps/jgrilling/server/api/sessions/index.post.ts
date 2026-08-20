import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import type { GrillSession } from '../../../app/utils/grillTypes'

/**
 * Open a grilling room. Body: { title?, plan?, repoPath?, key? }
 *
 * The caller — a Claude session acting as the interviewer — owns the whole
 * interview: it posts questions to /:key/questions and watches the session
 * file for answers. `plan` is the markdown under interrogation, shown to the
 * user for context. Returns { key, title, path: "/g/<key>" }.
 */
export default defineEventHandler(async (event) => {
  const body = (await readBody(event)) ?? {}
  const plan = String(body.plan ?? '').trim()

  const firstLine = plan.split('\n')[0]?.replace(/^#+\s*/, '').trim() ?? ''
  const title = String(body.title ?? '').trim() || firstLine.slice(0, 80)
  if (!title) throw createError({ statusCode: 400, message: 'missing `title` (or a `plan` to take one from)' })

  let repoPath: string | undefined
  const rawRepo = String(body.repoPath ?? '').trim()
  if (rawRepo) {
    repoPath = resolve(rawRepo.replace(/^~(?=$|\/)/, homedir()))
    if (!existsSync(repoPath)) {
      throw createError({ statusCode: 400, message: `repoPath does not exist: ${repoPath}` })
    }
  }

  const key = await uniqueGrillKey(String(body.key ?? '') || title)
  const now = new Date().toISOString()
  const session: GrillSession = {
    format: 'j-grilling',
    version: 2,
    key,
    title,
    plan,
    repoPath,
    status: 'active',
    createdAt: now,
    updatedAt: now,
    turns: [],
  }
  await writeGrill(session)
  return { key, title, path: `/g/${key}` }
})
