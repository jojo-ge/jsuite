// Cancel a run plan build: clear project.runPlanBuild and close the builder's
// herdr pane (best-effort). Whatever it saved so far stays as the draft.
// Returns { cancelled: boolean }.
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const project = findByRef(loadStore().projects, id)
  if (!project) throw createError({ statusCode: 404, statusMessage: 'project not found' })
  return { cancelled: await cancelRunPlanBuild(project.id) }
})
