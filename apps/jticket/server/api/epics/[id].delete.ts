export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id')
  const store = loadStore()
  const epic = store.epics.find((e) => e.id === id || e.key === id)
  if (!epic) throw createError({ statusCode: 404, statusMessage: 'epic not found' })

  store.epics = store.epics.filter((e) => e.id !== epic.id)
  // Orphan the epic's tickets rather than deleting them.
  for (const t of store.tickets) {
    if (t.epicId === epic.id) {
      t.epicId = null
      t.updatedAt = now()
    }
  }
  saveStore(store)
  return { ok: true }
})
