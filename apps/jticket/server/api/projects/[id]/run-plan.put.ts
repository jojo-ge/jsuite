// Save the project's run plan — the Run setup tab's steps (app/utils/runPlan.ts).
//
// Body: { steps: [{ id, kind: 'implement' | 'merge' | 'review' | 'gate',
//                   tickets?, reviewers?, base?, note? }] }
//
// A draft may be half-built: it's saved as sent and the problems that would
// stop it running come back alongside. While the plan is running, the steps
// it has started are frozen (409 if they change) and the rest must be
// runnable (409 with the problems) — the loop picks them up as it gets there.
//
// Returns { plan, problems: [{ stepId, message }] }.
import { coerceRunPlan } from '../../../../app/utils/runPlan'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const body = await readBody(event)
  const plan = coerceRunPlan(body)
  if (!plan) throw createError({ statusCode: 400, statusMessage: 'send {"steps": [...]}' })
  const store = loadStore()
  const project = store.projects.find((p) => p.id === id || p.key === id)
  if (!project) throw createError({ statusCode: 404, statusMessage: 'project not found' })
  if (project.share && project.share.side !== 'creator') {
    throw createError({ statusCode: 409, statusMessage: `${project.key} is shared with you — only its creator's side can plan its runs` })
  }
  const saved = saveRunPlan(store, project, plan)
  saveStore(store)
  return saved
})
