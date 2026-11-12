// Cancel the ticket plan session: clear project.ticketPlanBuild and close its
// herdr pane (best-effort). Whatever it drafted so far stays.
// Returns { cancelled: boolean }.
export default defineEventHandler(async (event) => {
  const project = findByRef(loadStore().projects, getRouterParam(event, 'id'))
  if (!project) throw createError({ statusCode: 404, statusMessage: 'project not found' })
  return { cancelled: await cancelTicketPlanBuild(project.id) }
})
