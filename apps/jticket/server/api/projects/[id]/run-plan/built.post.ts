// The `/jrunplan` session reporting that the plan is written: clears the
// build mark so the Run setup tab is editable again (and Start plan allowed).
//
// Body: { summary?: string }   // one line for the project's record — optional
//
// Returns { plan, problems } — the saved plan and anything that would stop it
// running (normally [] — the skill PUTs until the problems are gone).
//
// Refused (400) while an open ticket in an implement step has no prediction
// (`step.predictions[key]`, app/utils/runPlan.ts): the builder's bet on each
// ticket is what the run is later scored against, and it can't be recovered
// once the run has happened. The build mark stays, so the session fixes the
// plan and reports again.
import { unpredictedTickets } from '../../../../../app/utils/runPlan'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const body = (await readBody<{ summary?: unknown }>(event)) ?? {}
  const store = loadStore()
  const project = findByRef(store.projects, id)
  if (!project) throw createError({ statusCode: 404, statusMessage: 'project not found' })
  const plan = project.runPlan ?? { steps: [] }
  const open = new Set(store.tickets.filter((t) => t.projectId === project.id && t.status !== 'done' && t.status !== 'merged').map((t) => t.key))
  const unpredicted = unpredictedTickets(plan, open)
  if (unpredicted.length) {
    throw createError({
      statusCode: 400,
      statusMessage: `no prediction for ${unpredicted.join(', ')} — every open ticket in an implement step needs one in its step's "predictions" ({"<key>": {"weight", "minutes", "risk", "why"}}); PUT the plan with them, then report again`,
      data: { unpredicted },
    })
  }
  const was = clearRunPlanBuild(store, project)
  saveStore(store)
  return {
    wasBuilding: !!was,
    summary: typeof body.summary === 'string' ? body.summary.trim().slice(0, 500) : '',
    plan,
    problems: runPlanProblems(store, project, plan),
  }
})
