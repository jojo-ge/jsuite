/**
 * The human's "Post to PR" button. Body: { findingIds?: string[], body?: string }
 * — the findings to post (default: none) and the review's summary text, which
 * the human edits before pressing.
 *
 * Posts ONE GitHub pull-request review with the human's gh auth — event
 * COMMENT, always (server/utils/reviewGithub.ts hard-codes it; there is no
 * way to approve or request changes through here). Findings on a line the PR
 * changes go inline, the rest into the body. Each posted finding records
 * `postedAt`, and the press is logged on `review.prPosts`; a finding can be
 * posted again (a rerun's comments, a second push) — the page says it was.
 *
 * Human-only, like the ticket split: no skill or session may call it.
 */
const inFlight = new Set<string>()

export default defineEventHandler(async (event) => {
  const key = sanitizeReviewKey(getRouterParam(event, 'key'))
  const body = (await readBody(event)) ?? {}
  const review = await readReview(key)
  if (!review) throw createError({ statusCode: 404, message: `No such review: ${key}` })
  if (review.status !== 'triaged' && review.status !== 'ticketed') {
    throw createError({ statusCode: 409, message: `review is still ${review.status} — findings come first` })
  }
  const ids = Array.isArray(body.findingIds) ? new Set(body.findingIds.map(String)) : new Set<string>()
  const findings = review.findings.filter((f) => ids.has(f.id))
  if (ids.size && findings.length !== ids.size) throw createError({ statusCode: 400, message: 'some of those findings are not in this review' })
  const summary = typeof body.body === 'string' ? body.body.slice(0, 60_000) : ''

  if (inFlight.has(key)) throw createError({ statusCode: 409, message: 'already posting this review to GitHub' })
  inFlight.add(key)
  try {
    const { url, inline } = await postPrReview(review, findings, summary)
    const at = new Date().toISOString()
    const updated = await updateReview(key, (r) => {
      for (const f of r.findings) if (ids.has(f.id)) f.postedAt = at
      r.prPosts = [...(r.prPosts ?? []), { at, url, findingIds: findings.map((f) => f.id), inline }]
    })
    return { url, inline, posted: findings.length, review: updated }
  } finally {
    inFlight.delete(key)
  }
})
