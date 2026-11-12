// Delete a graph. Its projects are untouched — only the graph goes.
export default defineEventHandler((event) => {
  const store = loadStore()
  const graph = findGraph(store, getRouterParam(event, 'id'))
  store.graphs = store.graphs.filter((g) => g.id !== graph.id)
  saveStore(store)
  return { ok: true }
})
