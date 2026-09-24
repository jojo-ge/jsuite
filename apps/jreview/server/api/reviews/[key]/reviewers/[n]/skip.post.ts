/**
 * Give up on one reviewer so triage can go ahead without it. The watcher
 * dispatches triage on its next tick if everyone else is in. Its herdr pane
 * is left alone — close it by hand. Refused for a consensus review, where a
 * missing reviewer can't agree with anything. Returns the review.
 */
export default defineEventHandler(async (event) => {
  const key = sanitizeReviewKey(getRouterParam(event, 'key'))
  const n = Number(getRouterParam(event, 'n'))
  return updateReview(key, (r) => {
    if (r.status !== 'reviewing') {
      throw createError({ statusCode: 409, message: `review is ${r.status} — reviewers are finished` })
    }
    if (r.consensus) {
      throw createError({ statusCode: 409, message: 'a consensus review needs every reviewer — retry this one instead of skipping it' })
    }
    const reviewer = r.reviewers.find((x) => x.n === n)
    if (!reviewer) throw createError({ statusCode: 404, message: `No reviewer ${n}` })
    if (reviewer.status === 'done') throw createError({ statusCode: 409, message: `reviewer ${n} already reported` })
    reviewer.status = 'skipped'
  })
})
