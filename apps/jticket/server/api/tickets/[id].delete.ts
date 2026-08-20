export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id')
  const store = loadStore()
  const ticket = store.tickets.find((t) => t.id === id || t.key === id)
  if (!ticket) throw createError({ statusCode: 404, statusMessage: 'ticket not found' })

  store.tickets = store.tickets.filter((t) => t.id !== ticket.id)
  // Clean up dangling blocked-by edges pointing at the deleted ticket.
  for (const t of store.tickets) {
    if (t.blockedBy.includes(ticket.id)) {
      t.blockedBy = t.blockedBy.filter((b) => b !== ticket.id)
      t.updatedAt = now()
    }
  }
  // A PR is one ticket's review — merged ones stay as history, the rest go
  // with the ticket (branches on disk are untouched).
  store.prs = store.prs.filter((pr) => pr.ticketId !== ticket.id || pr.status === 'merged')
  saveStore(store)
  return { ok: true }
})
