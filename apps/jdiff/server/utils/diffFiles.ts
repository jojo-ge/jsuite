import { createHash } from 'node:crypto'
import type { FilePayload } from './buildDiff'
import type { ParsedTarget } from './target'

// The parsed + highlighted diff for a target, disk-cached. Shared by the
// /api/diff endpoint (what the review UI renders) and the tour export, so a
// shared walkthrough shows byte-identical hunks to the ones on screen.
export async function diffFilesFor(target: ParsedTarget, repoPath: string): Promise<FilePayload[]> {
  const prepared = await prepareTarget(target, repoPath)

  // Cached keyed by the head commit (and base, so re-basing a branch busts
  // it), so reopening an unchanged target skips the fetch, diff, and
  // highlighting.
  const cacheKey = target.kind === 'pr'
    ? target.storeKey
    : `${target.storeKey}..${prepared.base}..${target.scope}`

  // A worktree scope has no head commit to key on — every save changes the
  // diff without moving a ref. Producing the raw diff is cheap next to
  // parsing + highlighting it, so hash the raw text and let that be the key.
  if (prepared.worktree) {
    const raw = await rawDiff(prepared, repoPath, ['--no-color', '-M'])
    const oid = createHash('sha1').update(raw).digest('hex')
    const hit = loadDiff(repoPath, cacheKey, oid)
    if (hit) return hit.files

    const files = await buildDiff(raw)
    saveDiff(repoPath, cacheKey, { headOid: oid, createdAt: new Date().toISOString(), files })
    return files
  }

  const cached = loadDiff(repoPath, cacheKey, prepared.headOid)
  if (cached) return cached.files

  const raw = await rawDiff(prepared, repoPath, ['--no-color', '-M'])
  const files = await buildDiff(raw)

  saveDiff(repoPath, cacheKey, { headOid: prepared.headOid, createdAt: new Date().toISOString(), files })
  return files
}
