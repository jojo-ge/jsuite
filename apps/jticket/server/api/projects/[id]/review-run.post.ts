// A PR review project's run controls. Body: { action }
//   start    — run the review plan against the PR head as it is now
//   rerun    — re-fetch the PR, reopen every check, run the plan again
//   stop     — end the run now (sessions already in herdr carry on)
//   continue — pass the gate in progress
//   retry    — clear a pause and re-run the step it stopped on
// Returns the project's prReview.
import type { ReviewRunAction } from '../../../utils/prReview'

const ACTIONS: ReviewRunAction[] = ['start', 'rerun', 'stop', 'continue', 'retry']

export default defineEventHandler(async (event) => {
  const body = (await readBody<{ action?: string }>(event)) ?? {}
  const action = body.action as ReviewRunAction
  if (!ACTIONS.includes(action)) throw createError({ statusCode: 400, statusMessage: `action must be one of ${ACTIONS.join(', ')}` })
  return controlReviewRun(String(getRouterParam(event, 'id')), action)
})
