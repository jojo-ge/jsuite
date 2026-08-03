export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const body = await readBody<{ author?: string; body?: string }>(event)
  const store = loadStore()
  const ticket = store.tickets.find((t) => t.id === id || t.key === id)
  if (!ticket) throw createError({ statusCode: 404, statusMessage: 'ticket not found' })
  if (!body?.body?.trim()) throw createError({ statusCode: 400, statusMessage: 'body is required' })

  const comment: TicketComment = {
    id: newId('cmt'),
    author: typeof body.author === 'string' && body.author.trim() ? body.author.trim() : 'anonymous',
    body: body.body.trim(),
    createdAt: now(),
  }
  ticket.comments.push(comment)
  ticket.updatedAt = comment.createdAt
  saveStore(store)
  setResponseStatus(event, 201)
  return comment
})
