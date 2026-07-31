export default defineEventHandler(async (event) => {
  const body = await readBody<Partial<Ticket>>(event)
  if (!body?.title?.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'title is required' })
  }
  const store = loadStore()

  // Resolve epic ref (id or key) if provided.
  let epicId: string | null = null
  if (body.epicId) {
    const epic = store.epics.find((e) => e.id === body.epicId || e.key === body.epicId)
    if (!epic) throw createError({ statusCode: 400, statusMessage: `unknown epic: ${body.epicId}` })
    epicId = epic.id
  }

  // Resolve blockedBy refs (ids or keys) to ticket ids.
  const blockedBy = resolveTicketRefs(store, body.blockedBy ?? [])

  const ts = now()
  const ticket: Ticket = {
    id: newId('tick'),
    key: nextKey(store, 'ticket'),
    title: body.title.trim(),
    description: body.description?.trim() ?? '',
    acceptanceCriteria: (body.acceptanceCriteria ?? []).map((s) => String(s).trim()).filter(Boolean),
    type: body.type === 'HITL' ? 'HITL' : 'AFK',
    status: isStatus(body.status) ? body.status : 'todo',
    epicId,
    assignee: typeof body.assignee === 'string' ? body.assignee.trim() : '',
    labels: cleanLabels(body.labels),
    resolution: typeof body.resolution === 'string' ? body.resolution.trim() : '',
    blockedBy,
    createdAt: ts,
    updatedAt: ts,
  }
  store.tickets.push(ticket)
  saveStore(store)
  setResponseStatus(event, 201)
  return ticket
})
