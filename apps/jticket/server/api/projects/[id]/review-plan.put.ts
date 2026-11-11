// Save a PR review project's review plan (app/utils/reviewPlan.ts) — its own
// run setup, not the Run setup tab's run plan. Body: { steps: [{ id, kind:
// 'checks' | 'gate' | 'review', tickets?, runners?, reviewers?, model?,
// effort?, verify?, note? }] }. Saved as sent (made safe); the problems that
// would stop it running come back alongside. 409 while its run is going.
// Returns { plan, problems }.
import { coerceReviewPlan } from '../../../../app/utils/reviewPlan'

export default defineEventHandler(async (event) => {
  const plan = coerceReviewPlan(await readBody(event))
  if (!plan) throw createError({ statusCode: 400, statusMessage: 'send {"steps": [...]}' })
  const store = loadStore()
  const project = prReviewProject(store, getRouterParam(event, 'id'))
  const saved = saveReviewPlan(store, project, plan)
  saveStore(store)
  return saved
})
