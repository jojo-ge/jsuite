// One ticket's analytics row — its sessions stitched into the phase timeline
// the ticket modal shows. Computed over the ticket's project.
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const store = loadStore()
  const ticket = findByRef(store.tickets, id)
  if (!ticket) throw createError({ statusCode: 404, statusMessage: 'ticket not found' })
  return ticketSessions(store, ticket)
})
