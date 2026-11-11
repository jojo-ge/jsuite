// Review findings as tickets — the owner's rule, applied to every review kind:
// a review belongs to a jTicket project, and its findings are tickets on that
// project's board.
//
//   triage review     the human picks findings in the Review tab; each becomes
//                     an AFK bug ticket on the review's own project
//   consensus review  the consensus session files the agreed findings into the
//                     loop's project (it always did)
//   agreement review  a PR review project's run: every verified finding is
//                     filed on the project by the server as the consensus
//                     session hands it back — a RECORD-ONLY ticket (the code
//                     is someone else's pull request, so nothing is fixed
//                     here). A rerun matches the project's open finding
//                     tickets instead of filing duplicates, and Post to PR
//                     picks finding tickets.
//
// Pure: no Nuxt, no I/O — tests/reviewFindings.test.ts. The store side is
// server/utils/reviewTickets.ts.
import type { Finding, Review, Severity } from './reviewTypes'

/** The label every finding ticket carries. */
export const FINDING_LABEL = 'review:finding'
/** Stamped on a finding ticket once it has been posted to the PR. */
export const POSTED_LABEL = 'pr:posted'

/** What a finding ticket records about its finding (`ticket.finding`). */
export interface TicketFinding {
  /** The review that last raised it, and its id there (f1, f2, …). */
  review: string
  id: string
  severity: Severity
  category: string
  file?: string
  line?: number
  /** Whether the PR introduced it ('in') or it was there before ('out'). */
  scope?: 'in' | 'out'
  /** Adversarial verification's verdict, and the evidence in one line. */
  verdict?: 'confirmed' | 'plausible'
  verification?: string
  /** When it was last posted to the PR, and the GitHub review it went in. */
  postedAt?: string
  postedUrl?: string
  /** Set when a re-POST of its own review dropped it (the ticket was closed for it). */
  withdrawnAt?: string
}

type Labelled = { labels: readonly string[]; finding?: unknown }

/** A ticket a review finding became. */
export const isFindingTicket = (t: Labelled) => !!t.finding || t.labels.includes(FINDING_LABEL)

/**
 * The record-only rule: a finding ticket in a PR review project is a record of
 * something found in someone else's pull request — it has no herdr hand-off,
 * and nothing (a button, Run all, One session, the review plan) ever
 * dispatches it, least of all as a `/jpr-check`.
 */
export const isRecordOnly = (t: Labelled, projectMode: string | null | undefined) => projectMode === 'prreview' && isFindingTicket(t)

/** Why a ticket can't be dispatched — it is record-only — or '' when the rule doesn't apply. */
export function recordOnlyError(ticket: Labelled & { key: string }, project: { key: string; mode?: string | null } | null | undefined): string {
  return isRecordOnly(ticket, project?.mode)
    ? `${ticket.key} is a review finding on ${project!.key} — a record of what the review found in the pull request, not work: it has no hand-off and is never dispatched`
    : ''
}

/** The project a review belongs to — the one its findings are tickets on. */
export const reviewProjectKey = (r: Pick<Review, 'project' | 'consensus'>): string => r.project ?? r.consensus?.projectKey ?? ''

/**
 * Why a review can't start, or '' when it can: every review needs a project
 * (`project`, or a consensus review's `consensus.projectKey`), and it has to
 * exist. `exists` is the store lookup.
 */
export function reviewProjectProblem(
  input: { project?: unknown; consensus?: { projectKey?: unknown } | null },
  exists: (key: string) => boolean,
): string {
  const key = String(input.project || input.consensus?.projectKey || '').trim()
  if (!key) return 'a review belongs to a jTicket project — send `project` (PROJ-n); its findings become tickets on that board'
  return exists(key) ? '' : `project ${key} not found — a review can only start in an existing jTicket project`
}

// ── Finding → ticket matching ───────────────────────────────────────────────

/** One of the project's finding tickets (isFindingTicket), as the matcher reads it. */
export interface FindingTicketRef {
  key: string
  title: string
  status: string
  finding?: TicketFinding
}

/** A finding, as the matcher reads it. `ticketKey` is the consensus session's own match, when it named one. */
export type MatchableFinding = Pick<Finding, 'id' | 'title' | 'file' | 'category'> & { ticketKey?: string }

export interface FindingTicketPlan {
  /** findingId → the existing ticket it is (updated in place, never duplicated). */
  link: Map<string, string>
  /** Findings with no ticket yet, in the order sent. */
  create: string[]
  /** Open tickets this same review filed earlier and no longer raises — closed as withdrawn. */
  withdraw: string[]
}

const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean)
const normalTitle = (s: string) => words(s).join(' ')

/** Word overlap of two titles, 0…1 (Jaccard). */
export function titleSimilarity(a: string, b: string): number {
  const x = new Set(words(a))
  const y = new Set(words(b))
  if (!x.size || !y.size) return 0
  let shared = 0
  for (const w of x) if (y.has(w)) shared++
  return shared / (x.size + y.size - shared)
}

/** Two titles this alike, on the same file in the same category, are the same finding reworded. */
export const SAME_FINDING_SIMILARITY = 0.5

const isOpen = (status: string) => status === 'todo' || status === 'in_progress'

/**
 * Which ticket each finding of `reviewKey` is. `tickets` are the project's
 * finding tickets. A finding takes an existing one — the OPEN ones (an
 * earlier run's), plus the ones this very review filed (a re-POST), whatever
 * their status — in this order:
 *
 *   1. the ticket the consensus session named (`ticketKey`), when it is one of them
 *   2. the same title (case and punctuation aside) at the same place: the
 *      same file, or either side pinned to no file
 *   3. a reworded title (SAME_FINDING_SIMILARITY) on the same file in the
 *      same category — closest pairs first
 *
 * else it gets a new ticket. A ticket is taken once. Tickets this review
 * filed that none of its findings took any more are withdrawn.
 *
 * Deliberately conservative: a wrong match rewrites another defect's ticket
 * (and inherits its posted stamp), while a missed one only leaves a second
 * ticket. The same title on two files is two findings; a finding whose file
 * moved, or whose wording changed beyond pass 3, is the session's to match
 * (pass 1) — it reads the open tickets and can tell.
 */
export function planFindingTickets(input: { reviewKey: string; findings: MatchableFinding[]; tickets: FindingTicketRef[] }): FindingTicketPlan {
  const { reviewKey, findings } = input
  const pool = input.tickets.filter((t) => isOpen(t.status) || t.finding?.review === reviewKey)
  const taken = new Set<string>()
  const free = () => pool.filter((t) => !taken.has(t.key))
  const link = new Map<string, string>()
  const take = (f: MatchableFinding, t: FindingTicketRef | undefined) => {
    if (!t) return
    taken.add(t.key)
    link.set(f.id, t.key)
  }
  const samePlace = (f: MatchableFinding, t: FindingTicketRef) => !f.file || !t.finding?.file || t.finding.file === f.file

  // Each pass runs over every finding before the next, so a looser match never
  // takes the ticket a later finding matches exactly.
  for (const f of findings) take(f, f.ticketKey ? free().find((t) => t.key === f.ticketKey) : undefined)
  for (const f of findings) {
    if (link.has(f.id)) continue
    const same = free().filter((t) => normalTitle(t.title) === normalTitle(f.title) && samePlace(f, t))
    take(f, same.find((t) => !!f.file && t.finding?.file === f.file) ?? same[0])
  }
  const reworded = findings
    .filter((f) => !link.has(f.id) && !!f.file)
    .flatMap((f) =>
      free()
        .filter((t) => t.finding?.file === f.file && t.finding?.category === f.category)
        .map((t) => ({ f, t, score: titleSimilarity(t.title, f.title) })),
    )
    .filter((x) => x.score >= SAME_FINDING_SIMILARITY)
    .sort((a, b) => b.score - a.score)
  for (const { f, t } of reworded) if (!link.has(f.id) && !taken.has(t.key)) take(f, t)

  return {
    link,
    create: findings.filter((f) => !link.has(f.id)).map((f) => f.id),
    withdraw: pool.filter((t) => !taken.has(t.key) && t.finding?.review === reviewKey && isOpen(t.status)).map((t) => t.key),
  }
}

// ── What a finding ticket carries ───────────────────────────────────────────

/** The record a ticket keeps of its finding. `was` is the ticket's earlier record: its posted stamp survives a rerun. */
export function findingRecord(reviewKey: string, f: Finding, was?: TicketFinding): TicketFinding {
  return {
    review: reviewKey,
    id: f.id,
    severity: f.severity,
    category: f.category,
    ...(f.file ? { file: f.file } : {}),
    ...(f.line ? { line: f.line } : {}),
    ...(f.scope ? { scope: f.scope } : {}),
    ...(f.verdict ? { verdict: f.verdict } : {}),
    ...(f.verification ? { verification: f.verification } : {}),
    ...(was?.postedAt ? { postedAt: was.postedAt, ...(was.postedUrl ? { postedUrl: was.postedUrl } : {}) } : {}),
  }
}

/** Labels a finding owns on its ticket — replaced wholesale when a rerun updates it. */
const OWNED_LABEL = /^(severity|category|scope|verdict):/

/**
 * A finding ticket's labels. `recordOnly` (an agreement review's) makes it
 * HITL — it is the human's to read and post, never an agent's to take —
 * and adds the scope and verdict; anything else on `keep` (the ticket's
 * current labels) that the finding doesn't own stays.
 */
export function findingLabels(f: Finding, opts: { recordOnly: boolean; keep?: readonly string[] }): string[] {
  const own = [
    opts.recordOnly ? 'hitl' : 'afk',
    'jreview',
    FINDING_LABEL,
    `severity:${f.severity}`,
    `category:${f.category}`,
    ...(opts.recordOnly && f.scope ? [`scope:${f.scope}`] : []),
    ...(opts.recordOnly && f.verdict ? [`verdict:${f.verdict}`] : []),
  ]
  const kept = (opts.keep ?? []).filter((l) => l !== 'afk' && l !== 'hitl' && !OWNED_LABEL.test(l) && !own.includes(l))
  return [...own, ...kept]
}

/** `path:line` in backticks, or the words for "nowhere in particular". */
export const findingWhere = (f: Pick<Finding, 'file' | 'line'>) => (f.file ? `\`${f.file}${f.line ? `:${f.line}` : ''}\`` : 'not pinned to a file')

// ── Post to PR ──────────────────────────────────────────────────────────────

/**
 * The findings a Post to PR press sends: the review's findings whose tickets
 * were picked. `missing` are picked keys that are not one of this review's
 * finding tickets — the post is refused when there are any.
 */
export function findingsForTickets(review: Pick<Review, 'findings'>, ticketKeys: readonly string[]): { findings: Finding[]; missing: string[] } {
  const picked = new Set(ticketKeys)
  const findings = review.findings.filter((f) => f.ticketKey && picked.has(f.ticketKey))
  const found = new Set(findings.map((f) => f.ticketKey))
  return { findings, missing: [...picked].filter((k) => !found.has(k)) }
}
