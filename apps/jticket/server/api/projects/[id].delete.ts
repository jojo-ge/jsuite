export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id')
  const store = loadStore()
  const project = store.projects.find((p) => p.id === id || p.key === id)
  if (!project) throw createError({ statusCode: 404, statusMessage: 'project not found' })

  store.projects = store.projects.filter((p) => p.id !== project.id)
  // Orphan the project's epics and docs rather than deleting them.
  for (const e of store.epics) {
    if (e.projectId === project.id) {
      e.projectId = null
      e.updatedAt = now()
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
