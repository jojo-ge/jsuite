export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const body = await readBody<Partial<Ticket>>(event)
  const store = loadStore()
  const ticket = store.tickets.find((t) => t.id === id || t.key === id)
  if (!ticket) throw createError({ statusCode: 404, statusMessage: 'ticket not found' })

  // The peer's half of a shared project is read-only here — sync is the only
  // writer. Refused at the API, not just hidden in the UI.
  const project = store.projects.find((p) => p.id === ticket.projectId)
  // A ticket mid-transfer is frozen on both machines until the transferee
  // accepts or declines (spec DOC-30). Checked before the peer guard: the
  // transferor's pending copy is peer-owned too, and "frozen" is why.
  const frozen = transferFreezeError(ticket, project?.share)
  if (frozen) throw createError({ statusCode: 409, statusMessage: frozen })
  const refused = peerWriteError(ticket, project?.share)
  if (refused) throw createError({ statusCode: 403, statusMessage: refused })

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
  // The ticket's work branch — usually set by POST /api/tickets/:id/branch,
  // but adoptable by hand. Pass '' to clear.
  if (body.branch !== undefined) {
    const branch = typeof body.branch === 'string' ? body.branch.trim() : ''
    if (branch && !isSafeRef(branch)) throw createError({ statusCode: 400, statusMessage: `not a usable branch name: ${branch}` })
    ticket.branch = branch
  }

  // This ticket's own hand-off text, and whether it appends to or replaces the
  // prompt its project resolves to. The two are independent: emptying the text
  // leaves the mode alone, and setting the mode to '' keeps the draft.
  if (body.prompt !== undefined) ticket.prompt = cleanPromptText(body.prompt)
  if (body.promptMode !== undefined) ticket.promptMode = coercePromptMode(body.promptMode)

  if (body.projectId !== undefined) {
    let target: Project | null = null
    if (body.projectId !== null && body.projectId !== '') {
      target = store.projects.find((p) => p.id === body.projectId || p.key === body.projectId) ?? null
      if (!target) throw createError({ statusCode: 400, statusMessage: `unknown project: ${body.projectId}` })
    }
    // An actual move across the share boundary would smuggle in an unstamped,
    // non-parity entity — see projectMoveError. Same-project no-ops pass.
    if ((target?.id ?? null) !== ticket.projectId) {
      const moveRefused = projectMoveError(project?.share, target?.share)
      if (moveRefused) throw createError({ statusCode: 403, statusMessage: moveRefused })
    }
    ticket.projectId = target?.id ?? null
  }

  if (body.blockedBy !== undefined) {
    // Resolve refs and forbid a ticket blocking itself.
    ticket.blockedBy = resolveTicketRefs(store, body.blockedBy).filter((tid) => tid !== ticket.id)
  }

  ticket.updatedAt = now()
  saveStore(store)
  return ticket
})
