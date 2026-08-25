export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id')
  const commentId = getRouterParam(event, 'commentId')
  const store = loadStore()
  const ticket = store.tickets.find((t) => t.id === id || t.key === id)
  if (!ticket) throw createError({ statusCode: 404, statusMessage: 'ticket not found' })
  const idx = ticket.comments.findIndex((c) => c.id === commentId)
  if (idx === -1) throw createError({ statusCode: 404, statusMessage: 'comment not found' })

  // Comments are deletable on any ticket you can see — but only your own
  // side's. The peer's comments are their half of the merge set.
  const project = store.projects.find((p) => p.id === ticket.projectId)
  const refused = peerWriteError({ key: 'this comment', owner: ticket.comments[idx]!.owner }, project?.share)
  if (refused) throw createError({ statusCode: 403, statusMessage: refused })

  ticket.comments.splice(idx, 1)
  ticket.updatedAt = now()
  saveStore(store)
  return { ok: true }
})
