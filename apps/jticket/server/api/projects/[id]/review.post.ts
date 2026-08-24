// Run a jDiff review on the project's integration branch. The dispatched
// review session gets `project=<KEY>` so its findings come back as
// review:finding tickets in this project (the jdiff-review skill files them).
// Dispatch is --no-focus: this is background work, not a hand-off.
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const store = loadStore()
  const project = store.projects.find((p) => p.id === id || p.key === id)
  if (!project) throw createError({ statusCode: 404, statusMessage: 'project not found' })
  if (!project.repo.trim()) throw createError({ statusCode: 400, statusMessage: `${project.key} has no repo configured` })
  if (!project.integrationBranch.trim()) {
    throw createError({ statusCode: 400, statusMessage: `${project.key} has no integration branch to review` })
  }

  const path = resolveRepoDir(project.repo)
  const ctx = await repoContext(path)

  const res = await jdiffFetch<JdReviewDispatch>('/api/analyze-dispatch', {
    method: 'POST',
    timeout: JDIFF_DISPATCH_TIMEOUT,
    body: {
      repo: path,
      branch: project.integrationBranch,
      base: ctx.defaultBranch,
      project: project.key,
      focus: false,
    },
  })

  return { ...res, branch: project.integrationBranch, storeKey: `branch/${project.integrationBranch}` }
})
