/**
 * Re-dispatch the triage session — the retry after a failed herdr hand-off,
 * or a fresh one for a triager that stalled before POSTing findings. Only
 * valid while the review is `triaging`. Returns the review.
 */
export default defineEventHandler(async (event) => {
  const key = sanitizeReviewKey(getRouterParam(event, 'key'))
  await updateReview(key, (r) => {
    if (r.status !== 'triaging') {
      throw createError({ statusCode: 409, message: `review is ${r.status} — nothing to triage` })
    }
    r.triage.status = 'waiting'
    r.triage.error = undefined
  })
  await dispatchTriage(key)
  return readReview(key)
})
