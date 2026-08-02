import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import type { GrillSession } from '../../../app/utils/grillTypes'

/**
 * Start a grilling session. Body: { plan, title?, repoPath?, key? }
 *
 * `plan` is the markdown under interrogation. `repoPath` (optional) points
 * claude at the repo the plan concerns so it looks facts up instead of asking.
 * Returns { key, title, path: "/g/<key>" } — the room where the grilling runs.
 */
export default defineEventHandler(async (event) => {
  const body = (await readBody(event)) ?? {}
  const plan = String(body.plan ?? '').trim()
  if (!plan) throw createError({ statusCode: 400, message: 'missing `plan` — nothing to grill' })

  const firstLine = plan.split('\n')[0]!.replace(/^#+\s*/, '').trim()
  const title = String(body.title ?? '').trim() || firstLine.slice(0, 80) || 'Untitled plan'

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
    version: 1,
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
