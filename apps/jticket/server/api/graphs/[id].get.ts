// A graph by its id (G-KEY, any case) or by the key of any project in it.
export default defineEventHandler((event) => {
  const ref = String(getRouterParam(event, 'id')).toUpperCase()
  const graph = graphsView(loadStore()).find((g) => g.id === ref || g.projects.some((p) => p.key.toUpperCase() === ref))
  if (!graph) throw createError({ statusCode: 404, statusMessage: 'graph not found' })
  return graph
})
