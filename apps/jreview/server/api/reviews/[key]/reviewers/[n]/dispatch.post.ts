/**
 * (Re-)dispatch one reviewer — the retry after a failed herdr hand-off, or a
 * fresh session for one that stalled. Blocks until claude is up in its pane.
 * Returns the review.
 */
export default defineEventHandler(async (event) => {
  const key = sanitizeReviewKey(getRouterParam(event, 'key'))
  const n = Number(getRouterParam(event, 'n'))
  await updateReview(key, (r) => {
    if (r.status !== 'reviewing') {
      throw createError({ statusCode: 409, message: `review is ${r.status} — reviewers are finished` })
    }
    const reviewer = r.reviewers.find((x) => x.n === n)
    if (!reviewer) throw createError({ statusCode: 404, message: `No reviewer ${n}` })
    if (reviewer.status === 'done') throw createError({ statusCode: 409, message: `reviewer ${n} already reported` })
    reviewer.status = 'queued'
    reviewer.error = undefined
  })
  await dispatchReviewer(key, n)
  return readReview(key)
})
