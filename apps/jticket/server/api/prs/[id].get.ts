// One local PR (id or key), with the commits it carries — read live from git,
// so the list is always what the merge would actually take. A merged PR's head
// branch is usually gone; its commits list is empty and mergeCommit is the
// squash that landed.
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const store = loadStore()
  const pr = findPrRef(store, id)
  if (!pr) throw createError({ statusCode: 404, statusMessage: 'PR not found' })

  const project = store.projects.find((p) => p.id === pr.projectId)
  const path = project?.repo.trim() ? resolveRepoDir(project.repo) : null
  return {
    ...withPrDerived(store, pr, path),
    commits: path && pr.status !== 'merged' ? await listPrCommits(path, pr.baseBranch, pr.headBranch) : [],
  }
})
