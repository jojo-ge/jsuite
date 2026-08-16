// The ticket's artifacts, resolved: one row per ref, dangling ones included
// and flagged `missing`. Diff refs resolve against the repo of the ticket's
// project — a ticket in the backlog has no repo, so its diffs read as missing.
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const store = loadStore()
  const ticket = store.tickets.find((t) => t.id === id || t.key === id)
  if (!ticket) throw createError({ statusCode: 404, statusMessage: 'ticket not found' })
  const project = store.projects.find((p) => p.id === ticket.projectId)
  return await resolveAttachments(ticket.attachments, { repo: project?.repo })
})
