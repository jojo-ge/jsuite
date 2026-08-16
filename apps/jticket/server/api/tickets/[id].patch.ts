export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const body = await readBody<Partial<Ticket>>(event)
  const store = loadStore()
  const ticket = store.tickets.find((t) => t.id === id || t.key === id)
  if (!ticket) throw createError({ statusCode: 404, statusMessage: 'ticket not found' })

  if (body.title !== undefined) ticket.title = body.title.trim()
  if (body.description !== undefined) ticket.description = body.description.trim()
  if (body.acceptanceCriteria !== undefined) {
    ticket.acceptanceCriteria = body.acceptanceCriteria.map((s) => String(s).trim()).filter(Boolean)
  }
  if (body.type !== undefined) ticket.type = body.type === 'HITL' ? 'HITL' : 'AFK'
  if (body.status !== undefined && isStatus(body.status)) {
    // Stamp/clear the completion time alongside the status — never from the body.
    ticket.completedAt = stampCompletion(ticket, body.status, now())
    ticket.status = body.status
  }
  // Free-form assignee; pass '' (or null) to unassign. LLMs self-assign by name.
  if (body.assignee !== undefined) ticket.assignee = typeof body.assignee === 'string' ? body.assignee.trim() : ''
  if (body.labels !== undefined) ticket.labels = cleanLabels(body.labels)
  // The wayfinder answer. Pass '' to clear.
  if (body.resolution !== undefined) ticket.resolution = typeof body.resolution === 'string' ? body.resolution.trim() : ''

  if (body.projectId !== undefined) {
    if (body.projectId === null || body.projectId === '') {
      ticket.projectId = null
    } else {
      const project = store.projects.find((p) => p.id === body.projectId || p.key === body.projectId)
      if (!project) throw createError({ statusCode: 400, statusMessage: `unknown project: ${body.projectId}` })
      ticket.projectId = project.id
    }
  }

  // Artifact refs. Replaced wholesale like every other array on a PATCH — to
  // add or drop one without a read-modify-write, use POST/DELETE
  // /api/tickets/:id/attachments instead.
  if (body.attachments !== undefined) ticket.attachments = cleanAttachments(body.attachments)

  if (body.blockedBy !== undefined) {
    // Resolve refs and forbid a ticket blocking itself.
    ticket.blockedBy = resolveTicketRefs(store, body.blockedBy).filter((tid) => tid !== ticket.id)
  }

  ticket.updatedAt = now()
  saveStore(store)
  return ticket
})
