// One graph — by its id, its key (G-3, any case), or the key of a project in
// it (the old derived ids, G-<project key>, still resolve). The single-graph
// view adds each build node's slice size (time-boxed: 'unknown' rather than a
// wait) and the briefing each node was entered with.
export default defineEventHandler(async (event) => {
  const store = loadStore()
  const graph = findGraph(store, getRouterParam(event, 'id'))
  return graphView(store, graph, { slices: await graphSlices(store, graph), records: true })
})
