import { existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'

/**
 * GET /api/branches?repo=<path> — the branch picker's data: local branches,
 * remote-only origin branches, which one is checked out, the default target,
 * and each branch's open PR (whose base is the natural target — for a stacked
 * PR, its parent branch).
 */
export default defineEventHandler(async (event) => {
  const raw = String(getQuery(event).repo ?? '').trim()
  if (!raw) throw createError({ statusCode: 400, message: 'missing ?repo=' })
  const repo = resolve(raw.replace(/^~(?=$|\/)/, homedir()))
  if (!existsSync(repo) || !statSync(repo).isDirectory()) {
    throw createError({ statusCode: 400, message: `not a directory: ${repo}` })
  }
  return { repo, ...(await listBranches(repo)) }
})
