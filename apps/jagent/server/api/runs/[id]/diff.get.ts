import { createHash } from 'node:crypto'
import type { FilePayload } from '@jsuite/diff/types'

// The live diff. No headOid exists for a mutating tree, so the client polls
// with the hash it already holds: git re-runs every time (fast), shiki only
// when the raw text actually changed — the cost rate-limits itself to how
// fast the agent really writes.
export default defineEventHandler(async (event): Promise<
  { unchanged: true; hash: string } | { hash: string; files: FilePayload[] }
> => {
  const state = loadAgentState()
  const r = findRun(state, getRouterParam(event, 'id')!)
  const ws = findWorkspace(state, r.workspaceId)

  let raw = ''
  try {
    raw = await rawWorktreeDiff({ kind: 'worktree', dir: r.worktree, base: ws.base })
  } catch {
    // Mid-provision or torn down — an empty diff, not an error page.
  }
  const hash = createHash('sha1').update(raw).digest('hex')
  if (getQuery(event).hash === hash) return { unchanged: true, hash }
  const files = await buildDiff(raw)
  return { hash, files }
})
