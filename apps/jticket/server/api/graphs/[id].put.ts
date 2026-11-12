// Save a graph's whole shape — what every edit on the Graphs page sends.
//
// Body: { nodes: [{ id?, mode, projectId, title, note, stackOn }],
//         edges: [{ from, to }], title?, description? }
//
// A node without an id (or with one the graph doesn't know) is new. Saved as
// sent — a draft may be half-built — and the problems that make it unsound
// (a cycle, a project in two nodes or two graphs, a stackOn that isn't a
// direct upstream build) come back beside it, like a run plan's. The entered
// record (enteredAt, note, briefing) is Move on's and is kept as it was.
//
// Returns { graph, problems: [{ nodeId, message }] }.
export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  if (!body || typeof body !== 'object' || !Array.isArray(body.nodes)) {
    throw createError({ statusCode: 400, statusMessage: 'send {"nodes": [...], "edges": [...]}' })
  }
  const store = loadStore()
  const graph = findGraph(store, getRouterParam(event, 'id'))
  const problems = saveGraphShape(store, graph, body)
  saveStore(store)
  return { graph: graphView(store, graph), problems }
})
