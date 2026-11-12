// Backfill this project's sessions from its codebase's transcripts.
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const store = loadStore()
  const project = findByRef(store.projects, id)
  if (!project) throw createError({ statusCode: 404, statusMessage: 'project not found' })
  return backfillSessions(store, { projectIds: new Set([project.id]) })
})
