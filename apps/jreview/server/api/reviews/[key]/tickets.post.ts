import type { Finding, Review } from '../../../../app/utils/reviewTypes'

/**
 * The human's button: split the triaged findings into tickets in a NEW jTicket
 * project. Body: { findingIds?: string[] } — the findings to ticket (default:
 * all of them).
 *
 * Creates the project first (repo = the reviewed repo, so the tickets are
 * dispatchable from jTicket like any other), then imports one AFK bug ticket per
 * finding into it by key — never by title, which could match an older
 * project of the same name. Flips the review to `ticketed`; a second press is
 * a 409.
 */
const inFlight = new Set<string>()

export default defineEventHandler(async (event) => {
  const key = sanitizeReviewKey(getRouterParam(event, 'key'))
  const body = (await readBody(event)) ?? {}

  const review = await readReview(key)
  if (!review) throw createError({ statusCode: 404, message: `No such review: ${key}` })
  if (review.status === 'ticketed') {
    throw createError({ statusCode: 409, message: `already split into ${review.tickets?.projectKey}` })
  }
  if (review.status !== 'triaged') {
    throw createError({ statusCode: 409, message: `review is still ${review.status} — tickets come after triage` })
  }

  const wanted = Array.isArray(body.findingIds) ? new Set(body.findingIds.map(String)) : null
  const findings = review.findings.filter((f) => !wanted || wanted.has(f.id))
  if (!findings.length) throw createError({ statusCode: 400, message: 'no findings selected' })

  if (inFlight.has(key)) throw createError({ statusCode: 409, message: 'already creating tickets for this review' })
  inFlight.add(key)
  try {
    const project = await jticketCall<{ key: string }>('/api/projects', {
      method: 'POST',
      body: {
        title: `Review: ${review.title}`,
        repo: review.repoPath,
        description: projectDescription(review, findings.length),
      },
    })
    const imported = await jticketCall<{ tickets: { key: string }[] }>('/api/import', {
      method: 'POST',
      body: {
        tickets: findings.map((f) => ({
          title: f.title,
          description: ticketDescription(review, f),
          type: 'bug',
          project: project.key,
          labels: ['afk', 'jreview', 'review:finding', `severity:${f.severity}`, `category:${f.category}`],
          acceptanceCriteria: ['The failure scenario described above no longer occurs, and a test covers it'],
        })),
      },
    })
    const tickets = {
      projectKey: project.key,
      ticketKeys: imported.tickets.map((t) => t.key),
      createdAt: new Date().toISOString(),
    }
    await updateReview(key, (r) => {
      r.tickets = tickets
      r.status = 'ticketed'
    })
    return { ...tickets, url: `${JTICKET_PUBLIC}/projects/${project.key}` }
  } finally {
    inFlight.delete(key)
  }
})

const reviewUrl = (r: Review) => `https://jreview.local/r/${r.key}`
const docUrl = (docKey: string) => `https://jexplain.local/e/${docKey}`

function projectDescription(r: Review, count: number): string {
  const reports = r.reviewers
    .filter((x) => x.status === 'done')
    .map((x) => `[reviewer ${x.n}](${docUrl(x.docKey)})`)
    .join(' · ')
  return [
    `${count} finding${count === 1 ? '' : 's'} from the jReview run [${r.title}](${reviewUrl(r)}) over \`${r.repoPath}\` (\`${r.base}...${r.branch}\`${r.pr ? `, [PR #${r.pr.number}](${r.pr.url})` : ''}).`,
    '',
    `Deduplicated in the [triage report](${docUrl(r.triage.docKey)}). Raw reports: ${reports || 'none'}.`,
    '',
    'One ticket per finding, labelled `severity:*` and `category:*`.',
  ].join('\n')
}

function ticketDescription(r: Review, f: Finding): string {
  const where = f.file ? `\`${f.file}${f.line ? `:${f.line}` : ''}\`` : 'not pinned to a file'
  const by = f.reviewers.length
    ? `reviewer${f.reviewers.length === 1 ? '' : 's'} ${f.reviewers.join(', ')}`
    : 'the triager'
  return [
    `**Severity:** ${f.severity} · **Category:** ${f.category} · **Where:** ${where}`,
    '',
    f.summary,
    '',
    f.detail,
    '',
    '---',
    `Raised by ${by} in jReview [${r.title}](${reviewUrl(r)}) — see the [triage report](${docUrl(r.triage.docKey)}).`,
  ].join('\n')
}
