// Forget the link between a project's integration branch and its worktree.
// Only the record goes — the worktree on disk is left exactly as it is.
export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id')
  const store = loadStore()
  const project = store.projects.find((p) => p.id === id || p.key === id)
  if (!project) throw createError({ statusCode: 404, statusMessage: 'project not found' })
  const path = projectRepoPath(project)
  const repo = path ? findKnownRepo(store, path) : undefined
  const branch = project.integrationBranch.trim()
  const before = repo?.worktreeLinks.length ?? 0
  if (repo) repo.worktreeLinks = repo.worktreeLinks.filter((l) => l.branch !== branch)
  const forgotten = !!repo && repo.worktreeLinks.length !== before
  if (forgotten) saveStore(store)
  return { forgotten }
})
