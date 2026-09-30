// An orchestrated auto loop's phase, as its orchestrator sees it: every
// ticket of the phase (waiting / in-flight / finished), what's in flight, and
// the budget. 409 unless the project is running an orchestrated loop.
export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id')
  const store = loadStore()
  const project = store.projects.find((p) => p.id === id || p.key === id)
  if (!project) throw createError({ statusCode: 404, statusMessage: 'project not found' })
  return orchestratorQueue(store, project)
})
