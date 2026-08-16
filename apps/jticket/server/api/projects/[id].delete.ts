export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id')
  const store = loadStore()
  const project = store.projects.find((p) => p.id === id || p.key === id)
  if (!project) throw createError({ statusCode: 404, statusMessage: 'project not found' })

  store.projects = store.projects.filter((p) => p.id !== project.id)
  // Orphan the project's tickets rather than deleting them. Artifacts the
  // project had attached stay in their pools untouched — only the link,
  // which lived on the project record, goes with it.
  for (const t of store.tickets) {
    if (t.projectId === project.id) {
      t.projectId = null
      t.updatedAt = now()
    }
  }
  saveStore(store)
  return { ok: true }
})
