// The jButton: turn auto mode on or off, ask it to stop at the end of the
// loop in progress, or retry a paused step.
//
// Body: { enabled?: boolean, stopRequested?: boolean, retry?: boolean,
//         once?: boolean, tickets?: string[] }
//   enabled: true   — start looping (409 with the reason when the project
//                     can't: not standard mode, no repo, no integration
//                     branch, or shared with us by someone else)
//     once          — with enabled: true, run one loop and then turn off (the
//                     board's "Run as loop")
//     tickets       — with enabled: true, limit the first loop to these keys;
//                     409 unless at least one is an AFK frontier ticket (HITL
//                     and off-frontier picks are dropped)
//     orchestration — with enabled: true, { mode: 'sessions' | 'orchestrated',
//                     budget: 1…4 } — how implementing / fixing dispatch;
//                     kept for later runs. Left out = the last run's setting
//     plan          — with enabled: true, walk the project's Run setup plan
//                     (project.runPlan) step by step instead of looping; 409
//                     with the problems when it can't run as built
//   enabled: false  — off now; sessions already running in herdr carry on
//   stopRequested   — true = finish the loop in progress, then turn off;
//                     false = keep going after all
//   retry           — clear a pause and re-run the step it stopped on
//   continue        — run plan: pass the gate step in progress
//
// Returns the project's loop state. The loop itself is advanced by
// server/plugins/autoLoop.ts; enabling nudges the first tick straight away.
import { coerceOrchestration } from '../../../../app/utils/autoLoop'
import { PLAN_STEP_LABELS } from '../../../../app/utils/runPlan'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const body =
    (await readBody<{
      enabled?: unknown
      stopRequested?: unknown
      retry?: unknown
      once?: unknown
      tickets?: unknown
      orchestration?: unknown
      plan?: unknown
      continue?: unknown
    }>(event)) ?? {}
  const store = loadStore()
  const project = store.projects.find((p) => p.id === id || p.key === id)
  if (!project) throw createError({ statusCode: 404, statusMessage: 'project not found' })

  const enabling = body.enabled === true && !project.auto?.enabled
  if (enabling) {
    const blocked = autoModeBlocker(store, project)
    if (blocked) throw createError({ statusCode: 409, statusMessage: blocked })
  }

  // A run plan: the Run setup tab's, runnable as built.
  const plan = enabling && body.plan === true ? project.runPlan : undefined
  if (enabling && body.plan === true) {
    if (!plan?.steps.length) throw createError({ statusCode: 409, statusMessage: `${project.key} has no run plan — build one in the Run setup tab first` })
    const problems = runPlanProblems(store, project, plan)
    if (problems.length) throw createError({ statusCode: 409, statusMessage: problems.map((p) => p.message).join(' '), data: { problems } })
    if (!plan.steps.some((s) => s.kind === 'implement')) {
      throw createError({ statusCode: 409, statusMessage: `the plan has no ${PLAN_STEP_LABELS.implement} step — nothing would run` })
    }
  }

  // The picks a one-loop run is limited to — only the ones the loop could take.
  let only: string[] | undefined
  if (enabling && Array.isArray(body.tickets)) {
    const asked = new Set(body.tickets.filter((k): k is string => typeof k === 'string'))
    only = store.tickets
      .filter((t) => t.projectId === project.id && asked.has(t.key))
      .filter((t) => ticketIsFrontier(t, store.tickets, project.share) && !isHitl(t))
      .map((t) => t.key)
    if (asked.size && !only.length) {
      throw createError({ statusCode: 409, statusMessage: `none of ${[...asked].join(', ')} is an AFK ticket on ${project.key}'s frontier — the loop only runs those` })
    }
  }

  // Stop and retry only mean something to a running loop; don't mint loop
  // state on a project that never had one.
  if (!enabling && !project.auto?.enabled) {
    if (body.enabled === false) return project.auto ?? null
    throw createError({ statusCode: 409, statusMessage: `auto mode is off for ${project.key} — press the jButton first` })
  }

  const auto = setAutoMode(store, project, {
    enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
    stopRequested: typeof body.stopRequested === 'boolean' ? body.stopRequested : undefined,
    retry: body.retry === true,
    once: enabling && body.once === true,
    only,
    orchestration: enabling ? (coerceOrchestration(body.orchestration) ?? undefined) : undefined,
    plan: plan ?? undefined,
    continueGate: body.continue === true,
  })
  saveStore(store)

  if (enabling || body.retry === true || body.continue === true) void advanceAutoLoop(project.id)
  return auto
})
