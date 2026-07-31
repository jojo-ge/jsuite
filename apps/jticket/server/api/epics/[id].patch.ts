export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const body = await readBody<Partial<Epic>>(event)
  const store = loadStore()
  const epic = store.epics.find((e) => e.id === id || e.key === id)
  if (!epic) throw createError({ statusCode: 404, statusMessage: 'epic not found' })

  if (body.title !== undefined) epic.title = body.title.trim()
  if (body.description !== undefined) epic.description = body.description.trim()
  if (body.labels !== undefined) epic.labels = cleanLabels(body.labels)
  if (body.projectId !== undefined) {
    if (body.projectId === null || body.projectId === '') {
      epic.projectId = null
    } else {
      const project = store.projects.find((p) => p.id === body.projectId || p.key === body.projectId)
      if (!project) throw createError({ statusCode: 400, statusMessage: `unknown project: ${body.projectId}` })
      epic.projectId = project.id
    }
  }
  epic.updatedAt = now()

  saveStore(store)
  return epic
})
