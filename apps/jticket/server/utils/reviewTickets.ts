// Review findings → tickets, on the store. The rules (which ticket a finding
// is, what it carries, what makes it record-only) are app/utils/reviewFindings.ts;
// this file applies them to a Store the caller loaded and saves.
//
// Three writers, all in reviewActions.ts:
//   - the human's "Add N to KEY" for a triage review  → fileTriageFindings
//   - an agreement review's hand-back (POST /findings) → fileAgreementFindings
//   - a Post to PR press                               → stampPosted
// A consensus review's tickets are filed by its own session, through /api/import.
//
// Explicit imports, no Nitro globals: tests/reviewTickets.test.ts runs these
// over a plain Store object.
import {
  FINDING_LABEL,
  POSTED_LABEL,
  findingLabels,
  findingRecord,
  findingWhere,
  isFindingTicket,
  planFindingTickets,
} from '../../app/utils/reviewFindings'
import { reviewPath, type Finding, type Review } from '../../app/utils/reviewTypes'
import { entityOwnership, sharedTicketKey } from './ownership'
import { cleanLabels, isFinishedStatus, newId, nextKey, stampCompletion, type Project, type Store, type Ticket } from './store'

type ReviewForTicket = Pick<Review, 'key' | 'title' | 'pr' | 'triage' | 'agreement'>

/** A new ticket on `project`, minted the way /api/import mints one. */
function mintTicket(store: Store, project: Project, fields: Pick<Ticket, 'title' | 'description' | 'acceptanceCriteria' | 'labels' | 'finding'>, ts: string): Ticket {
  const ticket: Ticket = {
    id: newId('tick'),
    // A shared project mints under the shared key with this side's parity.
    key: project.share ? sharedTicketKey(project.share, store.tickets.filter((t) => t.projectId === project.id)) : nextKey(store, 'ticket'),
    title: fields.title,
    description: fields.description,
    acceptanceCriteria: fields.acceptanceCriteria,
    type: 'bug',
    status: 'todo',
    projectId: project.id,
    assignee: '',
    labels: cleanLabels(fields.labels),
    resolution: '',
    blockedBy: [],
    comments: [],
    branch: '',
    prompt: '',
    promptMode: '',
    completedAt: null,
    pickedUpAt: null,
    ...entityOwnership(project.share),
    transfer: '',
    transferAt: '',
    finding: fields.finding,
    createdAt: ts,
    updatedAt: ts,
  }
  store.tickets.push(ticket)
  return ticket
}

const raisedBy = (f: Finding) => (f.reviewers.length ? `reviewer${f.reviewers.length === 1 ? '' : 's'} ${f.reviewers.join(', ')}` : 'the triager')

/** A triage finding's ticket: work for an agent, so it has to stand on its own. `base` is jTicket's public URL. */
export function triageTicketDescription(r: ReviewForTicket, f: Finding, base: string): string {
  return [
    `**Severity:** ${f.severity} · **Category:** ${f.category} · **Where:** ${findingWhere(f)}`,
    '',
    f.summary,
    '',
    f.detail,
    '',
    '---',
    `Raised by ${raisedBy(f)} in review [${r.title}](${base}${reviewPath(r.key)}) — see the [triage report](${base}/e/${r.triage.docKey}).`,
  ].join('\n')
}

/** An agreement finding's ticket: a record of what the review found in the PR — scope, verdict, file and line included. */
export function agreementTicketDescription(r: ReviewForTicket, f: Finding, base: string): string {
  const facts = [
    `**Severity:** ${f.severity}`,
    `**Category:** ${f.category}`,
    `**Where:** ${findingWhere(f)}`,
    ...(f.scope ? [`**Scope:** ${f.scope === 'in' ? 'in — the PR introduced or changed it' : 'out — it was there before the PR'}`] : []),
    ...(f.verdict ? [`**Verdict:** ${f.verdict}`] : []),
  ]
  const pr = r.pr ? `[PR #${r.pr.number}](${r.pr.url})` : 'the pull request'
  return [
    facts.join(' · '),
    '',
    f.summary,
    '',
    f.detail,
    ...(f.verification ? ['', `**Verification:** ${f.verification}`] : []),
    '',
    '---',
    `A record, not work: ${f.reviewers.length ? `every reviewer (${f.reviewers.join(', ')}) raised this` : 'a check raised this'} in the review [${r.title}](${base}${reviewPath(r.key)})${r.agreement?.loop ? ` (run ${r.agreement.loop})` : ''} of ${pr} — see the [consensus report](${base}/e/${r.triage.docKey}). ` +
      'The code is someone else\'s, so nothing here is dispatched or fixed: post it to the PR from the project\'s Review tab, or close it when it no longer stands.',
  ].join('\n')
}

/**
 * The human's pick for a triage review: one AFK bug ticket per finding on
 * `project`. Returns findingId → the new ticket's key.
 */
export function fileTriageFindings(store: Store, project: Project, review: ReviewForTicket, findings: Finding[], ts: string, base: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const f of findings) {
    const ticket = mintTicket(
      store,
      project,
      {
        title: f.title,
        description: triageTicketDescription(review, f, base),
        acceptanceCriteria: ['The failure scenario described above no longer occurs, and a test covers it'],
        labels: findingLabels(f, { recordOnly: false }),
        finding: findingRecord(review.key, f),
      },
      ts,
    )
    out.set(f.id, ticket.key)
  }
  return out
}

export interface AgreementFiling {
  /** findingId → its ticket (new or matched). */
  byFinding: Map<string, string>
  created: string[]
  /** Open tickets of an earlier run (or an earlier POST) this review's findings matched — updated in place. */
  matched: string[]
  /** Tickets this review filed earlier and no longer raises — closed. */
  withdrawn: string[]
}

/**
 * File an agreement review's findings on its PR review project: each becomes
 * a record-only ticket carrying its scope, verdict, file and line — or, when
 * the project already holds an open ticket for it (a rerun, a re-POST),
 * updates that ticket instead of filing a duplicate. Each finding may name
 * the ticket it is (`ticketKey`, the consensus session's own match).
 */
export function fileAgreementFindings(store: Store, project: Project, review: ReviewForTicket, findings: Finding[], ts: string, base: string): AgreementFiling {
  const mine = store.tickets.filter((t) => t.projectId === project.id && isFindingTicket(t))
  const byKey = new Map(mine.map((t) => [t.key, t]))
  const plan = planFindingTickets({ reviewKey: review.key, findings, tickets: mine })

  const byFinding = new Map<string, string>()
  const created: string[] = []
  const matched: string[] = []
  for (const f of findings) {
    const fields = {
      title: f.title,
      description: agreementTicketDescription(review, f, base),
      acceptanceCriteria: [] as string[],
    }
    const ticket = byKey.get(plan.link.get(f.id) ?? '')
    if (!ticket) {
      const fresh = mintTicket(store, project, { ...fields, labels: findingLabels(f, { recordOnly: true }), finding: findingRecord(review.key, f) }, ts)
      byFinding.set(f.id, fresh.key)
      created.push(fresh.key)
      continue
    }
    // A ticket this review withdrew and now raises again comes back open.
    if (ticket.finding?.withdrawnAt && isFinishedStatus(ticket.status)) {
      ticket.completedAt = stampCompletion(ticket, 'todo', ts)
      ticket.status = 'todo'
      ticket.resolution = ''
    }
    Object.assign(ticket, fields, {
      labels: cleanLabels(findingLabels(f, { recordOnly: true, keep: ticket.labels })),
      finding: findingRecord(review.key, f, ticket.finding),
      updatedAt: ts,
    })
    byFinding.set(f.id, ticket.key)
    matched.push(ticket.key)
  }

  for (const key of plan.withdraw) {
    const ticket = byKey.get(key)!
    ticket.completedAt = stampCompletion(ticket, 'done', ts)
    ticket.status = 'done'
    ticket.resolution = `Withdrawn — the review ${review.key} handed its findings back again without this one.`
    ticket.finding = { ...ticket.finding!, withdrawnAt: ts }
    ticket.updatedAt = ts
  }
  return { byFinding, created, matched, withdrawn: plan.withdraw }
}

/**
 * Stamp "posted to the PR" on the tickets of the findings a Post to PR press
 * sent: `finding.postedAt` / `postedUrl` and the `pr:posted` label. A ticket
 * filed before tickets kept a finding record gets one now. Returns the keys
 * it stamped.
 */
export function stampPosted(store: Store, reviewKey: string, findings: Finding[], at: string, url: string): string[] {
  const stamped: string[] = []
  for (const f of findings) {
    const ticket = f.ticketKey ? store.tickets.find((t) => t.key === f.ticketKey) : undefined
    if (!ticket) continue
    ticket.finding = { ...(ticket.finding ?? findingRecord(reviewKey, f)), postedAt: at, postedUrl: url }
    ticket.labels = cleanLabels([...ticket.labels, ...(ticket.labels.includes(FINDING_LABEL) ? [] : [FINDING_LABEL]), POSTED_LABEL])
    ticket.updatedAt = at
    stamped.push(ticket.key)
  }
  return stamped
}
