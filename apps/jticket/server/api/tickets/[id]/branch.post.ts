// Cut the ticket's work branch: a LOCAL branch off the project's integration
// branch, recorded on the ticket (ticket.branch) so the hand-off prompt can
// name it and a local PR knows its head. Never pushed — single-ticket work
// stays local until its PR merges into the integration branch.
//
// Idempotent: a branch that already exists (here or cut by hand) is adopted,
// not re-cut.
//
// Body: { branch? }  — defaults to 'tick/<TICK-n>-<title-slug>'
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const body = await readBody<{ branch?: string }>(event).catch(() => ({}) as { branch?: string })
  const store = loadStore()
  const ticket = store.tickets.find((t) => t.id === id || t.key === id)
  if (!ticket) throw createError({ statusCode: 404, statusMessage: 'ticket not found' })
  const cut = await cutTicketBranch(store, ticket, body?.branch ?? '')
  saveStore(store)

  return {
    branch: cut.branch,
    base: cut.base,
    created: cut.created,
    adopted: cut.adopted,
    jdiffUrl: jdiffBranchUrl(cut.path, cut.branch, cut.base),
  }
})
