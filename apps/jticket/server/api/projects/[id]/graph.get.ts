// Which graph and node this project sits in — the project page's strip:
// the graph, the node (with its state and whether it was entered), and the
// projects before and after it. { graph: null } when it's in none.
export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id')
  const store = loadStore()
  const project = findByRef(store.projects, id)
  if (!project) throw createError({ statusCode: 404, statusMessage: 'project not found' })
  return projectGraphPlace(store, project)
})
