export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const body = await readBody<Partial<Project>>(event)
  const store = loadStore()
  const project = store.projects.find((p) => p.id === id || p.key === id)
  if (!project) throw createError({ statusCode: 404, statusMessage: 'project not found' })

  if (body.title !== undefined) project.title = body.title.trim()
  if (body.description !== undefined) project.description = body.description.trim()
  if (body.mode !== undefined) project.mode = body.mode === 'wayfinder' ? 'wayfinder' : 'standard'
  project.updatedAt = now()

  saveStore(store)
  return project
})
