// Point a plan review project at the plan it reviews — the Review tab's plan
// picker, for one a graph node made with no single plan before it (or whose
// plan was deleted). Body: { plan: 'PROJ-n' } (a plan project's key or id).
// Nothing is started. 409 once it has reviewed a different plan that still
// exists — make a new plan review for that one.
export default defineEventHandler(async (event) => {
  const body = (await readBody<{ plan?: unknown }>(event)) ?? {}
  const store = loadStore()
  const project = attachPlanToReview(store, getRouterParam(event, 'id'), body.plan)
  saveStore(store)
  return project
})
