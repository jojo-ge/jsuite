import { PROJECT_KEY_SHAPE, unticketedFindings, type Finding, type Review } from '../../../../app/utils/reviewTypes'

/**
 * The human's button: turn triaged findings into jTicket tickets. Body:
 * { findingIds?: string[], projectKey?: string } — the findings to ticket
 * (default: all of them) and the project to add them to.
 *
 * The target is `projectKey`, else the project the findings already went to,
 * else the project the review belongs to (`review.project` — jTicket's Review
 * tab), else a NEW project (repo = the reviewed repo's main checkout — a
 * review started from a worktree still lands in the codebase's own project
 * list — so the tickets are dispatchable from jTicket like any other).
 * One AFK bug ticket per finding is imported into it by key — never by title,
 * which could match an older project of the same name.
 *
 * Findings that already became tickets are skipped, so the button can be
 * pressed again for the ones left over — but only into the same project.
 * Each finding records its `ticketKey`; the review flips to `ticketed`.
 */
const inFlight = new Set<string>()

export default defineEventHandler(async (event) => {
  const key = sanitizeReviewKey(getRouterParam(event, 'key'))
  const body = (await readBody(event)) ?? {}

  const review = await readReview(key)
  if (!review) throw createError({ statusCode: 404, message: `No such review: ${key}` })
  if (review.consensus) {
    throw createError({ statusCode: 409, message: `review ${key} is a consensus review — its session files its own tickets` })
  }
  if (review.status !== 'triaged' && review.status !== 'ticketed') {
    throw createError({ statusCode: 409, message: `review is still ${review.status} — tickets come after triage` })
  }

  const asked = String(body.projectKey ?? '').trim()
  if (asked && !PROJECT_KEY_SHAPE.test(asked)) {
    throw createError({ statusCode: 400, message: 'projectKey must be a jTicket project key (PROJ-n)' })
  }
  const filedInto = review.tickets?.projectKey
  if (asked && filedInto && asked !== filedInto) {
    throw createError({ statusCode: 409, message: `this review's findings already went to ${filedInto} — add the rest there` })
  }
  const target = asked || filedInto || review.project || ''

  const wanted = Array.isArray(body.findingIds) ? new Set(body.findingIds.map(String)) : null
  const findings = unticketedFindings(review).filter((f) => !wanted || wanted.has(f.id))
  if (!findings.length) {
    throw createError({ statusCode: 400, message: wanted ? 'the selected findings are already tickets' : 'every finding is already a ticket' })
  }

  if (inFlight.has(key)) throw createError({ statusCode: 409, message: 'already creating tickets for this review' })
  inFlight.add(key)
  try {
    let projectKey = target
    if (projectKey) {
      await jticketCall(`/api/projects/${encodeURIComponent(projectKey)}`) // 404s cleanly when it's gone
    } else {
      const project = await jticketCall<{ key: string }>('/api/projects', {
        method: 'POST',
        body: {
          title: `Review: ${review.title}`,
          repo: await mainCheckout(review.repoPath),
          description: projectDescription(review, findings.length),
        },
      })
      projectKey = project.key
    }
    const imported = await jticketCall<{ tickets: { key: string }[] }>('/api/import', {
      method: 'POST',
      body: {
        tickets: findings.map((f) => ({
          title: f.title,
          description: ticketDescription(review, f),
          type: 'bug',
          project: projectKey,
          labels: ['afk', 'jreview', 'review:finding', `severity:${f.severity}`, `category:${f.category}`],
          acceptanceCriteria: ['The failure scenario described above no longer occurs, and a test covers it'],
        })),
      },
    })
    // Import answers in the order it was sent — finding i became ticket i.
    const byFinding = new Map(findings.map((f, i) => [f.id, imported.tickets[i]?.key]))
    const updated = await updateReview(key, (r) => {
      for (const f of r.findings) {
        const ticketKey = byFinding.get(f.id)
        if (ticketKey) f.ticketKey = ticketKey
      }
      const added = [...byFinding.values()].filter((k): k is string => !!k)
      r.tickets = {
        projectKey,
        ticketKeys: [...(r.tickets?.ticketKeys ?? []), ...added],
        createdAt: r.tickets?.createdAt ?? new Date().toISOString(),
      }
      r.status = 'ticketed'
    })
    return {
      ...updated.tickets!,
      added: imported.tickets.map((t) => t.key),
      url: `${JTICKET_PUBLIC}/projects/${projectKey}`,
    }
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
