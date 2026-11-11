import { APPROVAL_VERDICTS, SEVERITIES, type Finding, type ReviewAssessment, type Severity } from '../../../../app/utils/reviewTypes'

/**
 * The triage session's hand-back. Body: { findings: Finding[] } — or, from an
 * agreement review's consensus session, { findings, assessment, considered,
 * kept }: each finding may carry `scope` ('in' | 'out'), `verdict`
 * ('confirmed' | 'plausible' — refuted ones are never sent) and
 * `verification` (one line of evidence); `assessment` is { verdict, summary,
 * blockers[], reviewerVerdicts? } — a recommendation the human reads. Nothing
 * acts on it: jReview never approves a PR.
 *
 * The only writer of `review.findings`, and the only thing that flips a
 * review to `triaged`. Validates wholesale: findings without a title are
 * dropped, severities coerced, reviewer slots clamped, ids reassigned f1…fn
 * in the order sent (the triager sends them most-severe first). Re-POSTing
 * replaces the set — until the human has split them into tickets.
 *
 * The first POST opens the review in the browser — its jTicket project's
 * Review tab when it belongs to one, else its page here. The triage session's
 * panes are closed by the watcher, so that page is where the human picks it up.
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
      ...(raw?.scope === 'in' || raw?.scope === 'out' ? { scope: raw.scope } : {}),
      ...(raw?.verdict === 'confirmed' || raw?.verdict === 'plausible' ? { verdict: raw.verdict } : {}),
      ...(str(raw?.verification, 500) ? { verification: str(raw?.verification, 500) } : {}),
    })
  }

  let assessment: ReviewAssessment | undefined
  const a = body.assessment
  if (current.agreement && a && typeof a === 'object' && APPROVAL_VERDICTS.includes(a.verdict)) {
    assessment = {
      verdict: a.verdict,
      summary: str(a.summary, 4000),
      blockers: (Array.isArray(a.blockers) ? a.blockers : []).map((b: unknown) => str(b, 300)).filter(Boolean).slice(0, 20),
      ...(Array.isArray(a.reviewerVerdicts)
        ? {
            reviewerVerdicts: a.reviewerVerdicts
              .filter((v: any) => Number.isInteger(Number(v?.n)) && Number(v.n) >= 1 && Number(v.n) <= slots && APPROVAL_VERDICTS.includes(v?.verdict))
              .map((v: any) => ({ n: Number(v.n), verdict: v.verdict })),
          }
        : {}),
    }
  }
  const count = (v: unknown) => (Number.isInteger(Number(v)) && Number(v) >= 0 ? Number(v) : undefined)

  const review = await updateReview(key, (r) => {
    if (r.status === 'ticketed') {
      throw createError({ statusCode: 409, message: `review ${key} was already split into ${r.tickets?.projectKey}` })
    }
    // Re-POSTing replaces the set, but keeps what the human already did with a finding.
    const before = new Map(r.findings.map((f) => [f.title, f]))
    r.findings = findings.map((f) => {
      const was = before.get(f.title)
      return was ? { ...f, ...(was.ticketKey ? { ticketKey: was.ticketKey } : {}), ...(was.postedAt ? { postedAt: was.postedAt } : {}) } : f
    })
    if (r.agreement) {
      if (assessment) r.assessment = assessment
      r.agreement.considered = count(body.considered)
      r.agreement.kept = count(body.kept) ?? findings.length
    }
    r.status = 'triaged'
    r.triage.status = 'done'
    r.triage.error = undefined
    r.triage.doneAt = new Date().toISOString()
  })
  if (current.status !== 'triaged') void openReviewInBrowser(current)
  return { key: review.key, findings: review.findings.length, path: `/r/${review.key}` }
})
