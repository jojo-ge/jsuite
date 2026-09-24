// A codebase's worktree guide (?repo= path, ~/… or slug) — how this codebase
// makes, sets up, runs and tears down worktrees. Every worktree consumer
// (/jimplement, /jreproduce, jReview, the integration branch's connect) reads
// this first. `state` is re-derived on every read: 'stale' means a file the
// guide rests on has changed since it was written (`changed` names them), so
// follow it with care and say so. See server/utils/worktrees.ts.
export default defineEventHandler((event) => {
  const store = loadStore()
  const path = resolveRepoParam(store, getQuery(event).repo)
  if (!path) throw createError({ statusCode: 400, statusMessage: 'missing ?repo=' })
  const guide = findKnownRepo(store, path)?.worktreeGuide ?? null
  return { repo: path, guide, ...guideState(path, guide) }
})
