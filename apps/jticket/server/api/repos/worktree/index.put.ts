// Write a codebase's worktree guide (?repo=). The kickoff agent calls this once
// it has proven the guide on a throwaway worktree. Replaces the whole guide:
//   { body: markdown, root?: dir, sources?: [repo-relative paths], verified?: bool, author?: string }
// `sources` are hashed now — when any of them changes, the guide reads as
// stale. A repo jTicket hasn't seen yet is remembered, as long as it is a real
// clone.
export default defineEventHandler(async (event) => {
  const store = loadStore()
  const path = resolveRepoParam(store, getQuery(event).repo)
  if (!path) throw createError({ statusCode: 400, statusMessage: 'missing ?repo=' })

  if (!findKnownRepo(store, path)) {
    const probe = await probeRepo(path)
    if (!probe.ok) throw createError({ statusCode: 400, statusMessage: `${probe.error}: ${probe.path}` })
    rememberRepo(store, { path: probe.path, slug: probe.slug ?? '', defaultBranch: probe.defaultBranch }, { touch: false })
  }
  const repo = findKnownRepo(store, path)!

  const built = buildGuide(path, (await readBody<Record<string, unknown>>(event)) ?? {}, now())
  if (!built.ok) throw createError({ statusCode: 400, statusMessage: built.error })
  repo.worktreeGuide = built.guide
  saveStore(store)
  return { repo: path, guide: built.guide, ...guideState(path, built.guide) }
})
