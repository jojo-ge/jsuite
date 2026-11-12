// The plan project's ticket plan (ticketPlanOf in server/utils/ticketPlan.ts):
// its graph, the proposed builds with the drafts planned for each and each
// node's note, the reviews after them, drafts whose node is gone, and the
// warnings worth reading before Approve. 409 on a project that isn't a plan.
export default defineEventHandler((event) => {
  const store = loadStore()
  const project = findByRef(store.projects, getRouterParam(event, 'id'))
  if (!project) throw createError({ statusCode: 404, statusMessage: 'project not found' })
  if (project.mode !== 'plan') throw createError({ statusCode: 409, statusMessage: `${project.key} isn't a plan project — only a plan has a ticket plan` })
  return ticketPlanOf(store, project)
})
