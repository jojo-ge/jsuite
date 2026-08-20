// Sync the project's integration branch to origin — a plain push, one-way.
// The local branch is the source of truth (jTicket is the only writer: local
// PR merges land there), so there is nothing to pull; this is the ONLY remote
// action in the local-PR workflow besides cutting the branch itself.
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const store = loadStore()
  const project = store.projects.find((p) => p.id === id || p.key === id)
  if (!project) throw createError({ statusCode: 404, statusMessage: 'project not found' })

  const path = resolveRepoDir(project.repo)
  const branch = project.integrationBranch.trim()
  if (!branch) throw createError({ statusCode: 400, statusMessage: `${project.key} has no integration branch` })
  if (!(await localBranchExists(path, branch))) {
    throw createError({ statusCode: 400, statusMessage: `integration branch not in this clone: ${branch}` })
  }

  await run('git', ['push', '--set-upstream', 'origin', `${branch}:${branch}`], path)
  return { branch, pushed: true }
})
