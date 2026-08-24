// Initiate an ownership transfer (spec DOC-30): hand this side's ticket to
// the peer. The owner flips to them immediately and the ticket freezes here —
// still exported, so the peer's next pull presents it as a pending offer they
// accept or decline. No cancel: an unanswered offer comes back only via the
// peer declining it.
export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id')
  const store = loadStore()
  const ticket = store.tickets.find((t) => t.id === id || t.key === id)
  if (!ticket) throw createError({ statusCode: 404, statusMessage: 'ticket not found' })
  const project = store.projects.find((p) => p.id === ticket.projectId)

  // Every refusal is a state conflict: not shared, peer-owned, already in
  // transfer — the state machine words the message.
  const refused = initiateTransfer(ticket, project?.share, now())
  if (refused) throw createError({ statusCode: 409, statusMessage: refused })

  ticket.updatedAt = now()
  saveStore(store)
  return ticket
})
