export default defineEventHandler(async (event) => {
  const body = await readBody<Partial<Project>>(event)
  if (!body?.title?.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'title is required' })
  }
  const store = loadStore()
  const ts = now()
  const project: Project = {
    id: newId('proj'),
    key: nextKey(store, 'project'),
    title: body.title.trim(),
    description: body.description?.trim() ?? '',
    mode: body.mode === 'wayfinder' ? 'wayfinder' : 'standard',
    createdAt: ts,
    updatedAt: ts,
  }
  store.projects.push(project)
  saveStore(store)
  setResponseStatus(event, 201)
  return project
})
