/**
 * The consensus session's hand-back, for a consensus review (jTicket's auto
 * loop). Body: { ticketKeys: string[], considered?: number, kept?: number }
 *
 * By the time this lands the session has already filed one jTicket ticket per
 * agreed finding into `consensus.projectKey` — jReview keeps only the keys,
 * never the findings themselves. Zero tickets is a valid answer: the
 * reviewers agreed on nothing. Flips the review to `ticketed`, which is what
 * the auto loop polls for. Re-POSTing replaces the keys.
 */
export default defineEventHandler(async (event) => {
  const key = sanitizeReviewKey(getRouterParam(event, 'key'))
  const body = (await readBody(event)) ?? {}
  if (!Array.isArray(body.ticketKeys)) {
    throw createError({ statusCode: 400, message: 'body must be { ticketKeys: [...] }' })
  }
  const ticketKeys = [...new Set<string>(body.ticketKeys.map((k: unknown) => String(k).trim()))].filter((k) =>
    /^[A-Za-z][A-Za-z0-9]*-\d+$/.test(k),
  )
  const count = (v: unknown) => (Number.isInteger(Number(v)) && Number(v) >= 0 ? Number(v) : undefined)

  const review = await updateReview(key, (r) => {
    if (!r.consensus) {
      throw createError({ statusCode: 409, message: `review ${key} is not a consensus review — POST /findings instead` })
    }
    if (r.status === 'reviewing') {
      throw createError({ statusCode: 409, message: `review ${key} is still waiting on its reviewers` })
    }
    const now = new Date().toISOString()
    r.consensus.considered = count(body.considered)
    r.consensus.kept = count(body.kept) ?? ticketKeys.length
    r.tickets = { projectKey: r.consensus.projectKey, ticketKeys, createdAt: now }
    r.status = 'ticketed'
    r.triage.status = 'done'
    r.triage.error = undefined
    r.triage.doneAt = now
  })
  return { key: review.key, projectKey: review.tickets!.projectKey, ticketKeys: review.tickets!.ticketKeys }
})
