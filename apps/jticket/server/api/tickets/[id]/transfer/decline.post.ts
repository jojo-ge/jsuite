// Decline a pending ownership transfer (spec DOC-30): ownership bounces
// straight back to the peer here, and the decline marker travels with this
// side's next served snapshot so the transferor's pull unfreezes their copy.
export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id')
  const store = loadStore()
  const ticket = store.tickets.find((t) => t.id === id || t.key === id)
  if (!ticket) throw createError({ statusCode: 404, statusMessage: 'ticket not found' })
  const project = store.projects.find((p) => p.id === ticket.projectId)

  const refused = declineTransfer(ticket, project?.share)
  if (refused) throw createError({ statusCode: 409, statusMessage: refused })

  ticket.updatedAt = now()
  saveStore(store)
  return ticket
})
