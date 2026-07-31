export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id')
  const store = loadStore()
  const epic = store.epics.find((e) => e.id === id || e.key === id)
  if (!epic) throw createError({ statusCode: 404, statusMessage: 'epic not found' })
  return {
    ...epic,
    tickets: store.tickets.filter((t) => t.epicId === epic.id),
  }
})
