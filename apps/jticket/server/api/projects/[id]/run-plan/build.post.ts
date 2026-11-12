// The Run setup tab's Build button: dispatch one Fable 5.2 `/jrunplan` session
// (the `runplan:build` hand-off, prompt layers applied) that reads the project
// and writes its run plan. Marks project.runPlanBuild until the session
// reports back (POST …/run-plan/built) or is cancelled (DELETE …/run-plan/build).
//
// 409: not a standard project, no repo, shared with us, auto mode on, or a
// build whose session is still live. Returns { agent, paneId }.
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const project = findByRef(loadStore().projects, id)
  if (!project) throw createError({ statusCode: 404, statusMessage: 'project not found' })
  const res = await startRunPlanBuild(project.id)
  setResponseStatus(event, 202)
  return res
})
