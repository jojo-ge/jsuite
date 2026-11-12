// The Ticket plan tab's button: dispatch one `/jplan-to-jtickets` session (the
// `ticketplan:build` hand-off, prompt layers applied) that writes the spec,
// drafts the build tickets on the plan and proposes the graph's shape. Makes
// the plan's graph first when it has none. Marks project.ticketPlanBuild until
// the session reports back (POST …/ticket-plan/built) or is cancelled
// (DELETE …/ticket-plan/build).
//
// 409: not a plan project, no repo, shared with us, or a session still live.
// Returns { agent, paneId, graph } (202).
export default defineEventHandler(async (event) => {
  const project = findByRef(loadStore().projects, getRouterParam(event, 'id'))
  if (!project) throw createError({ statusCode: 404, statusMessage: 'project not found' })
  const res = await startTicketPlanBuild(project.id)
  setResponseStatus(event, 202)
  return res
})
