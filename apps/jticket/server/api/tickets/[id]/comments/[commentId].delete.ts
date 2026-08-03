export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id')
  const commentId = getRouterParam(event, 'commentId')
  const store = loadStore()
  const ticket = store.tickets.find((t) => t.id === id || t.key === id)
  if (!ticket) throw createError({ statusCode: 404, statusMessage: 'ticket not found' })
  const idx = ticket.comments.findIndex((c) => c.id === commentId)
  if (idx === -1) throw createError({ statusCode: 404, statusMessage: 'comment not found' })
  ticket.comments.splice(idx, 1)
  ticket.updatedAt = now()
  saveStore(store)
  return { ok: true }
})
