// The Reviews board's Open PRs section: the codebase's open GitHub PRs via
// `gh pr list` (held 30s per repo; ?force=1 refetches), plus who gh is
// signed in as, for the "only mine" and "i'm reviewing" filters.
// ?repo= is a codebase path. A gh failure comes back as `error`, not a 500,
// so the rest of the board still renders.
export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const repo = String(q.repo ?? '')
  if (!repo) throw createError({ statusCode: 400, statusMessage: 'send ?repo=<codebase path>' })
  const cwd = resolveRepoDir(repo)
  try {
    const [prs, viewer] = await Promise.all([listOpenPrs(cwd, !!q.force), ghViewer(cwd)])
    return { error: '', viewer, prs }
  } catch (err: any) {
    return { error: String(err?.statusMessage ?? err?.message ?? err).slice(0, 500), viewer: '', prs: [] }
  }
})
