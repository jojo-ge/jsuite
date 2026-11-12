// The plan's graph, get-or-create: the graph the plan project sits in, or a
// new one made around it (titled after the plan, in its codebase). Idempotent
// — the /jplan-to-jtickets session calls it first, then adds proposed nodes
// with POST /api/graphs/:graph/nodes.
//
// Returns { graph, planNodeId, created } (201 when made).
export default defineEventHandler((event) => {
  const store = loadStore()
  const project = findByRef(store.projects, getRouterParam(event, 'id'))
  if (!project) throw createError({ statusCode: 404, statusMessage: 'project not found' })
  if (project.mode !== 'plan') throw createError({ statusCode: 409, statusMessage: `${project.key} isn't a plan project — only a plan has a ticket plan` })
  const { graph, planNodeId, created } = ensurePlanGraph(store, project)
  if (created) {
    saveStore(store)
    setResponseStatus(event, 201)
  }
  return { graph: graphView(store, graph), planNodeId, created }
})
