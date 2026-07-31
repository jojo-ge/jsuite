export default defineEventHandler(async (event) => {
  const body = await readBody<Partial<Epic>>(event)
  if (!body?.title?.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'title is required' })
  }
  const store = loadStore()

  // Resolve project ref (id or key) if provided.
  let projectId: string | null = null
  if (body.projectId) {
    const project = store.projects.find((p) => p.id === body.projectId || p.key === body.projectId)
    if (!project) throw createError({ statusCode: 400, statusMessage: `unknown project: ${body.projectId}` })
    projectId = project.id
  }

  const ts = now()
  const epic: Epic = {
    id: newId('epic'),
    key: nextKey(store, 'epic'),
    title: body.title.trim(),
    description: body.description?.trim() ?? '',
    projectId,
    labels: cleanLabels(body.labels),
    createdAt: ts,
    updatedAt: ts,
  }
  store.epics.push(epic)
  saveStore(store)
  setResponseStatus(event, 201)
  return epic
})
