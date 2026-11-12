// Approve the ticket plan: each build node with drafts gets its project and
// its drafts move in (projectId ← the build, plannedFor ← null; blockers carry
// over). Starts nothing and enters nothing; review and plan review nodes stay
// proposed until the human moves on into them.
//
// Body: { nodes?: [nodeId] }   // only these builds; omitted = every build with drafts
//
// Returns { approved: [{ nodeId, project, created, moved: [TICK-n], notes }], plan }.
// 409: not a plan, shared, a session still drafting, or no drafts to approve.
export default defineEventHandler(async (event) => {
  const body = (await readBody<{ nodes?: unknown }>(event)) ?? {}
  return approveTicketPlan(String(getRouterParam(event, 'id')), body)
})
