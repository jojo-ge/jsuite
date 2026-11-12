export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id')
  const store = loadStore()
  const project = findByRef(store.projects, id)
  if (!project) throw createError({ statusCode: 404, statusMessage: 'project not found' })
  return {
    ...project,
    tickets: store.tickets.filter((t) => t.projectId === project.id),
  }
})
