import type { FilePayload } from '../utils/buildDiff'

export type { FilePayload } from '../utils/buildDiff'

export default defineEventHandler(async (event): Promise<{ files: FilePayload[] }> => {
  const path = resolveRepoPath(event)
  const target = resolveTarget(event)

  const prepared = await prepareTarget(target, path)

  // The parsed + highlighted diff is cached on disk keyed by the head commit
  // (and base, so re-basing a branch busts it), so reopening an unchanged
  // target skips the fetch, diff, and highlighting.
  const cacheKey = target.kind === 'pr' ? target.storeKey : `${target.storeKey}..${prepared.base}`
  const cached = loadDiff(path, cacheKey, prepared.headOid)
  if (cached) return { files: cached.files }

  const raw = await run('git', ['diff', '--no-color', '-M', prepared.range], path)
  const files = await buildDiff(raw)

  saveDiff(path, cacheKey, { headOid: prepared.headOid, createdAt: new Date().toISOString(), files })
  return { files }
})
