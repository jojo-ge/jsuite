export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id')
  const store = loadStore()
  const project = store.projects.find((p) => p.id === id || p.key === id)
  if (!project) throw createError({ statusCode: 404, statusMessage: 'project not found' })

  store.projects = store.projects.filter((p) => p.id !== project.id)
  // Orphan the project's tickets and docs rather than deleting them.
  for (const t of store.tickets) {
    if (t.projectId === project.id) {
      t.projectId = null
      t.updatedAt = now()
    }
  }
  for (const d of store.docs) {
    if (d.projectId === project.id) {
      d.projectId = null
      d.updatedAt = now()
    }
  }
  saveStore(store)
  return { ok: true }
})
