// Rename or redescribe a graph. Body: { title?, description?, repo? }.
// The shape (nodes, edges) is PUT /api/graphs/:id's.
export default defineEventHandler(async (event) => {
  const body = (await readBody(event)) ?? {}
  const store = loadStore()
  const graph = findGraph(store, getRouterParam(event, 'id'))
  if (typeof body.title === 'string') {
    if (!body.title.trim()) throw createError({ statusCode: 400, statusMessage: 'a graph needs a title' })
    graph.title = body.title.trim().slice(0, 200)
  }
  if (typeof body.description === 'string') graph.description = body.description.trim()
  if (typeof body.repo === 'string') graph.repo = expandHome(body.repo)
  graph.updatedAt = now()
  saveStore(store)
  return graphView(store, graph)
})
