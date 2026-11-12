// Add one node. Body: { projectId } (an existing project, by id or key) or
// { mode, title, note? } (a proposed one — no project until Move on), plus
// optionally { after: [nodeId…] } for the edges into it and { stackOn }.
// Returns { node, graph, problems } (201).
export default defineEventHandler(async (event) => {
  const body = (await readBody(event)) ?? {}
  const store = loadStore()
  const graph = findGraph(store, getRouterParam(event, 'id'))
  const { node, problems } = addGraphNode(store, graph, body)
  saveStore(store)
  setResponseStatus(event, 201)
  return { node, graph: graphView(store, graph), problems }
})
