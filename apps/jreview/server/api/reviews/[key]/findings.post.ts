import { SEVERITIES, type Finding, type Severity } from '../../../../app/utils/reviewTypes'

/**
 * The triage session's hand-back. Body: { findings: Finding[] }
 *
 * The only writer of `review.findings`, and the only thing that flips a
 * review to `triaged`. Validates wholesale: findings without a title are
 * dropped, severities coerced, reviewer slots clamped, ids reassigned f1…fn
 * in the order sent (the triager sends them most-severe first). Re-POSTing
 * replaces the set — until the human has split them into tickets.
 */
export default defineEventHandler(async (event) => {
  const key = sanitizeReviewKey(getRouterParam(event, 'key'))
  const body = (await readBody(event)) ?? {}
  if (!Array.isArray(body.findings)) {
    throw createError({ statusCode: 400, message: 'body must be { findings: [...] }' })
  }

  const current = await readReview(key)
  if (!current) throw createError({ statusCode: 404, message: `no review ${key}` })
  if (current.consensus) {
    throw createError({ statusCode: 409, message: `review ${key} is a consensus review — POST /api/reviews/${key}/consensus instead` })
  }
  const slots = current.reviewers.length

  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
  const findings: Finding[] = []
  for (const raw of body.findings) {
    const title = str(raw?.title, 200)
    if (!title) continue
    const severity: Severity = SEVERITIES.includes(raw?.severity) ? raw.severity : 'medium'
    const line = Number(raw?.line)
    const reviewers = [...new Set<number>((Array.isArray(raw?.reviewers) ? raw.reviewers : []).map(Number))]
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= slots)
      .sort((a, b) => a - b)
    findings.push({
      id: `f${findings.length + 1}`,
      title,
      severity,
      category: str(raw?.category, 40).toLowerCase().replace(/[^a-z0-9-]+/g, '-') || 'general',
      file: str(raw?.file, 300) || undefined,
      line: Number.isInteger(line) && line > 0 ? line : undefined,
      summary: str(raw?.summary, 1000),
      detail: str(raw?.detail, 20_000),
      reviewers,
    })
  }

  const review = await updateReview(key, (r) => {
    if (r.status === 'ticketed') {
      throw createError({ statusCode: 409, message: `review ${key} was already split into ${r.tickets?.projectKey}` })
    }
    r.findings = findings
    r.status = 'triaged'
    r.triage.status = 'done'
    r.triage.error = undefined
    r.triage.doneAt = new Date().toISOString()
  })
  return { key: review.key, findings: review.findings.length, path: `/r/${review.key}` }
})
