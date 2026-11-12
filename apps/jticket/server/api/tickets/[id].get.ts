export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id')
  const store = loadStore()
  const ticket = findByRef(store.tickets, id)
  if (!ticket) throw createError({ statusCode: 404, statusMessage: 'ticket not found' })
  return withDerived(ticket, store.tickets, shareForTicket(store, ticket), ticketIsRecordOnly(store, ticket))
})
