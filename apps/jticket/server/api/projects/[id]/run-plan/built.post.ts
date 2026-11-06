// The `/jrunplan` session reporting that the plan is written: clears the
// build mark so the Run setup tab is editable again (and Start plan allowed).
//
// Body: { summary?: string }   // one line for the project's record — optional
//
// Returns { plan, problems } — the saved plan and anything that would stop it
// running (normally [] — the skill PUTs until the problems are gone).
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const body = (await readBody<{ summary?: unknown }>(event)) ?? {}
  const store = loadStore()
  const project = store.projects.find((p) => p.id === id || p.key === id)
  if (!project) throw createError({ statusCode: 404, statusMessage: 'project not found' })
  const was = clearRunPlanBuild(store, project)
  saveStore(store)
  const plan = project.runPlan ?? { steps: [] }
  return {
    wasBuilding: !!was,
    summary: typeof body.summary === 'string' ? body.summary.trim().slice(0, 500) : '',
    plan,
    problems: runPlanProblems(store, project, plan),
  }
})
