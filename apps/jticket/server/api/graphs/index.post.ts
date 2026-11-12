// Create a graph. Body: { title, repo, description?, nodes?, edges? } — the
// shape, when sent, is saved as PUT /api/graphs/:id saves it.
// Returns { graph, problems } (201).
export default defineEventHandler(async (event) => {
  const body = (await readBody(event)) ?? {}
  if (!String(body.title ?? '').trim()) throw createError({ statusCode: 400, statusMessage: 'title is required' })
  const store = loadStore()
  const graph = createGraph(store, body)
  const problems = body.nodes || body.edges ? saveGraphShape(store, graph, body) : problemsOf(store, graph)
  saveStore(store)
  setResponseStatus(event, 201)
  return { graph: graphView(store, graph), problems }
})
