// Fast-forward the project's integration branch to origin's — for commits
// pushed from elsewhere (a teammate, another clone). Never merges: a branch
// that has diverged is a 409. See fastForwardFromOrigin.
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const store = loadStore()
  const project = store.projects.find((p) => p.id === id || p.key === id)
  if (!project) throw createError({ statusCode: 404, statusMessage: 'project not found' })

  const path = resolveRepoDir(project.repo)
  const branch = project.integrationBranch.trim()
  if (!branch) throw createError({ statusCode: 400, statusMessage: `${project.key} has no integration branch` })
  return { branch, ...(await fastForwardFromOrigin(path, branch)) }
})
