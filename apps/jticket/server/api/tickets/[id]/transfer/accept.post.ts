// Accept a pending ownership transfer (spec DOC-30): the explicit human step
// that turns the offered copy into a plain owned ticket — editable and
// dispatchable from here on. The transferor finalizes on their next pull,
// when this side's export shows the ticket as plainly its own.
export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id')
  const store = loadStore()
  const ticket = store.tickets.find((t) => t.id === id || t.key === id)
  if (!ticket) throw createError({ statusCode: 404, statusMessage: 'ticket not found' })
  const project = store.projects.find((p) => p.id === ticket.projectId)

  const refused = acceptTransfer(ticket, project?.share)
  if (refused) throw createError({ statusCode: 409, statusMessage: refused })

  ticket.updatedAt = now()
  saveStore(store)
  return ticket
})
