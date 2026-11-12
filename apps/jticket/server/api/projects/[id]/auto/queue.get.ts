// An orchestrated auto loop's phase, as its orchestrator sees it: every
// ticket of the phase (waiting / in-flight / human / other / finished), what's
// in flight, and the budget. `?orchestrator=n` (1-based) scopes it to one of
// several orchestrators running side by side — the others' tickets read
// `other`. 409 unless the project is running an orchestrated loop.
export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id')
  const q = getQuery(event)
  const n = q.orchestrator === undefined || q.orchestrator === '' ? undefined : Number(q.orchestrator)
  const store = loadStore()
  const project = findByRef(store.projects, id)
  if (!project) throw createError({ statusCode: 404, statusMessage: 'project not found' })
  return orchestratorQueue(store, project, n)
})
