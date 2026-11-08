// Backfill this project's sessions from its codebase's transcripts.
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const store = loadStore()
  const project = store.projects.find((p) => p.id === id || p.key === id)
  if (!project) throw createError({ statusCode: 404, statusMessage: 'project not found' })
  return backfillSessions(store, { projectIds: new Set([project.id]) })
})
