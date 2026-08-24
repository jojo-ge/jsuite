// Run a jDiff review on a local PR's head branch (vs its base). The dispatched
// review session gets `ticket=<KEY>` so its findings come back as a comment on
// the PR's ticket. Only open/conflicted PRs can be reviewed — a merged PR's
// head branch is gone.
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const store = loadStore()
  const pr = findPrRef(store, id)
  if (!pr) throw createError({ statusCode: 404, statusMessage: 'PR not found' })
  if (pr.status === 'merged' || pr.status === 'closed') {
    throw createError({ statusCode: 400, statusMessage: `${pr.key} is ${pr.status} — its head branch is no longer reviewable` })
  }

  const project = store.projects.find((p) => p.id === pr.projectId)
  if (!project) throw createError({ statusCode: 400, statusMessage: 'the PR\'s project is gone' })
  const path = resolveRepoDir(project.repo)
  const ticket = store.tickets.find((t) => t.id === pr.ticketId)

  const res = await jdiffFetch<JdReviewDispatch>('/api/analyze-dispatch', {
    method: 'POST',
    timeout: JDIFF_DISPATCH_TIMEOUT,
    body: {
      repo: path,
      branch: pr.headBranch,
      base: pr.baseBranch,
      ticket: ticket?.key,
      focus: false,
    },
  })

  return { ...res, branch: pr.headBranch, storeKey: `branch/${pr.headBranch}` }
})
