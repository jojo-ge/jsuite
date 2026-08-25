export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id')
  const store = loadStore()
  const ticket = store.tickets.find((t) => t.id === id || t.key === id)
  if (!ticket) throw createError({ statusCode: 404, statusMessage: 'ticket not found' })

  // Peer-owned tickets only ever leave by sync (deletion by absence), never
  // by a local delete.
  const project = store.projects.find((p) => p.id === ticket.projectId)
  // Mid-transfer = frozen (spec DOC-30): the pending copy must survive on
  // both machines until the offer is answered. Before the peer guard — the
  // transferor's pending copy is peer-owned too, and "frozen" is why.
  const frozen = transferFreezeError(ticket, project?.share)
  if (frozen) throw createError({ statusCode: 409, statusMessage: frozen })
  const refused = peerWriteError(ticket, project?.share)
  if (refused) throw createError({ statusCode: 403, statusMessage: refused })

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
