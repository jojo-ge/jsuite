// Save the project's run plan — the Run setup tab's steps (app/utils/runPlan.ts).
//
// Body: { steps: [{ id, kind: 'implement' | 'merge' | 'review' | 'gate',
//                   tickets?, reviewers?, base?, note? }] }
//
// A draft may be half-built: it's saved as sent and the problems that would
// stop it running come back alongside. While the plan is running it is locked
// whole (409) — Unlock & stop in Run setup ends the run first. A /jrunplan
// build saves through here too (its PUTs are how the agent iterates).
//
// Returns { plan, problems: [{ stepId, message }] }.
import { coerceRunPlan } from '../../../../app/utils/runPlan'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const body = await readBody(event)
  const plan = coerceRunPlan(body)
  if (!plan) throw createError({ statusCode: 400, statusMessage: 'send {"steps": [...]}' })
  const store = loadStore()
  const project = findByRef(store.projects, id)
  if (!project) throw createError({ statusCode: 404, statusMessage: 'project not found' })
  if (project.share && project.share.side !== 'creator') {
    throw createError({ statusCode: 409, statusMessage: `${project.key} is shared with you — only its creator's side can plan its runs` })
  }
  const saved = saveRunPlan(store, project, plan)
  saveStore(store)
  return saved
})
