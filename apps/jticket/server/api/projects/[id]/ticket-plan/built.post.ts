// The `/jplan-to-jtickets` session reporting that the ticket plan is drafted:
// clears the in-progress mark so the tab is editable (and Approve allowed).
//
// Body: { summary?: string }   // one line: builds, reviews, anything left out
//
// Returns { wasBuilding, summary, plan } — plan is the ticket plan as saved.
export default defineEventHandler(async (event) => {
  const body = (await readBody<{ summary?: unknown }>(event)) ?? {}
  const store = loadStore()
  const project = findByRef(store.projects, getRouterParam(event, 'id'))
  if (!project) throw createError({ statusCode: 404, statusMessage: 'project not found' })
  const was = clearTicketPlanBuild(project)
  saveStore(store)
  return {
    wasBuilding: !!was,
    summary: typeof body.summary === 'string' ? body.summary.trim().slice(0, 500) : '',
    plan: project.mode === 'plan' ? ticketPlanOf(store, project) : null,
  }
})
