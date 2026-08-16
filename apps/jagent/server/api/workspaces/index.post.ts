import { existsSync } from 'node:fs'
import { basename, resolve } from 'node:path'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ repo?: string; name?: string; base?: string; setup?: string }>(event)
  const repoInput = (body?.repo ?? '').trim()
  if (!repoInput) throw createError({ statusCode: 400, message: 'repo path is required' })
  const repo = resolve(repoInput.replace(/^~(?=\/|$)/, process.env.HOME ?? '~'))
  if (!existsSync(repo)) throw createError({ statusCode: 400, message: `not a directory: ${repo}` })
  await run('git', ['rev-parse', '--git-dir'], repo) // throws if not a git repo

  const base = (body?.base ?? '').trim() || (await defaultBranch(repo))
  const ws = {
    id: newAgentId('ws'),
    name: (body?.name ?? '').trim() || basename(repo),
    repo,
    base,
    // undefined → the suite default; an explicit '' means no setup step.
    setup: body?.setup === undefined ? 'pnpm install' : String(body.setup).trim(),
    fleet: false,
    fleetSlots: 2,
    maxWorktrees: 8,
    queue: [],
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }
  mutateAgentState((s) => s.workspaces.push(ws))
  setResponseStatus(event, 201)
  return ws
})
