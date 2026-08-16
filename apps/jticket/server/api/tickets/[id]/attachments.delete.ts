// Unlink an artifact from a ticket: ?type=&id= (a diff id contains a slash, so
// it travels as a query param, not a route segment). The artifact itself is
// untouched — jTicket only ever owned the link.
export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id')
  const { type, id: artifactId } = getQuery(event)
  const store = loadStore()
  const ticket = store.tickets.find((t) => t.id === id || t.key === id)
  if (!ticket) throw createError({ statusCode: 404, statusMessage: 'ticket not found' })
  if (!isAttachmentType(type)) {
    throw createError({ statusCode: 400, statusMessage: 'need ?type=document|chart|diff&id=' })
  }

  ticket.attachments = removeAttachment(ticket.attachments, { type, id: String(artifactId ?? '') })
  ticket.updatedAt = now()
  saveStore(store)
  return ticket.attachments
})
