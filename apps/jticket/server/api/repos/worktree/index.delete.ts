// Drop a codebase's worktree guide (?repo=). Consumers fall back to plain
// `git worktree add` until the kickoff runs again; links are kept — they
// describe worktrees that still exist on disk.
export default defineEventHandler((event) => {
  const store = loadStore()
  const path = resolveRepoParam(store, getQuery(event).repo)
  if (!path) throw createError({ statusCode: 400, statusMessage: 'missing ?repo=' })
  const repo = findKnownRepo(store, path)
  const had = !!repo?.worktreeGuide
  if (repo && had) {
    repo.worktreeGuide = null
    saveStore(store)
  }
  return { cleared: had }
})
