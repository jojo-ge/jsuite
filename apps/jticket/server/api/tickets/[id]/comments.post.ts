export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const body = await readBody<{ author?: string; body?: string }>(event)
  const store = loadStore()
  const ticket = store.tickets.find((t) => t.id === id || t.key === id)
  if (!ticket) throw createError({ statusCode: 404, statusMessage: 'ticket not found' })
  if (!body?.body?.trim()) throw createError({ statusCode: 400, statusMessage: 'body is required' })

  // Deliberately NOT peer-guarded: on a shared project both sides may comment
  // on any ticket (comment sets merge per ticket during sync). The comment
  // itself is stamped with this side, so only its author's side can delete it.
  const project = store.projects.find((p) => p.id === ticket.projectId)
  const comment: TicketComment = {
    id: newId('cmt'),
    author: typeof body.author === 'string' && body.author.trim() ? body.author.trim() : 'anonymous',
    body: body.body.trim(),
    createdAt: now(),
    ...entityOwnership(project?.share),
  }
  ticket.comments.push(comment)
  ticket.updatedAt = comment.createdAt
  saveStore(store)
  setResponseStatus(event, 201)
  return comment
})
