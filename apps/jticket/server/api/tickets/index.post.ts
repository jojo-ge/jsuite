export default defineEventHandler(async (event) => {
  const body = await readBody<Partial<Ticket>>(event)
  if (!body?.title?.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'title is required' })
  }
  const store = loadStore()

  // Resolve project ref (id or key) if provided.
  let projectId: string | null = null
  if (body.projectId) {
    const project = store.projects.find((p) => p.id === body.projectId || p.key === body.projectId)
    if (!project) throw createError({ statusCode: 400, statusMessage: `unknown project: ${body.projectId}` })
    projectId = project.id
  }

  // Resolve blockedBy refs (ids or keys) to ticket ids.
  const blockedBy = resolveTicketRefs(store, body.blockedBy ?? [])

  const ts = now()
  const status = isStatus(body.status) ? body.status : 'todo'
  const ticket: Ticket = {
    id: newId('tick'),
    key: nextKey(store, 'ticket'),
    title: body.title.trim(),
    description: body.description?.trim() ?? '',
    acceptanceCriteria: (body.acceptanceCriteria ?? []).map((s) => String(s).trim()).filter(Boolean),
    type: body.type === 'HITL' ? 'HITL' : 'AFK',
    status,
    projectId,
    assignee: typeof body.assignee === 'string' ? body.assignee.trim() : '',
    labels: cleanLabels(body.labels),
    resolution: typeof body.resolution === 'string' ? body.resolution.trim() : '',
    blockedBy,
    comments: [],
    // Created straight into 'done' (an already-finished ticket being recorded)
    // counts as finishing now.
    completedAt: status === 'done' ? ts : null,
    createdAt: ts,
    updatedAt: ts,
  }
  store.tickets.push(ticket)
  saveStore(store)
  setResponseStatus(event, 201)
  return ticket
})
