// Branches in the project's repo — local and on origin, newest commit first —
// for the "use an existing branch" picker. This is how a project adopts an
// integration branch that was cut outside jTicket.
//
// ?q=      filter by name or commit subject
// ?fetch=1 prune + refresh origin first (a network round-trip; the picker's ↻)
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const query = getQuery(event)
  const store = loadStore()
  const project = store.projects.find((p) => p.id === id || p.key === id)
  if (!project) throw createError({ statusCode: 404, statusMessage: 'project not found' })

  const path = projectRepoDir(project.repo)
  const branches = await listBranches(path, {
    q: query.q == null ? '' : String(query.q),
    fetch: !!query.fetch,
  })
  return { branches, current: project.integrationBranch }
})
