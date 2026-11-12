// A review node and the project it reviews, in a graph — the two hand-offs
// between them:
//
//   in   entering a proposed Review node attaches the upstream build's roll-up
//        PR when one is open (reviewedUpstream + rollupToAttach)
//   out  Send back: findings the human picks on the review become normal,
//        dispatchable tickets on that upstream project (planSendBack +
//        sendBackDraft); each finding ticket records the ticket it became
//        (`ticket.sentBack`), so sending it twice files nothing new
//
// Which upstream, and what a sent-back finding becomes, are a rule per review
// mode (SEND_BACK_RULES): a PR review sends bugs back to its build, a plan
// review decision tickets back to its plan (the plan it records, in a graph
// or not — server/utils/reviewHandoff.ts).
//
// Pure: no Nuxt, no I/O — tests/reviewHandoff.test.ts. The store side is
// server/utils/reviewHandoff.ts.
import { upstreamNodes, type Graph } from './graphs'
import { findingWhere, isFindingTicket, type TicketFinding } from './reviewFindings'

/** What a finding ticket records once it was sent back (`ticket.sentBack`). */
export interface TicketSentBack {
  /** The ticket it became, and that ticket's project. The key is kept for display; the id is what's looked up. */
  ticketId: string
  ticketKey: string
  projectId: string
  at: string
}

/** Every ticket a send-back files carries this label. */
export const SENT_BACK_LABEL = 'review:sent-back'

export interface SendBackRule {
  /** The mode of the upstream node findings go back to. */
  upstreamMode: string
  /** What the new ticket is: its type and agency tag. */
  type: string
  agency: 'afk' | 'hitl'
  acceptanceCriteria: string[]
  /** The last line of the new ticket: what to do with it, and where. */
  instruction: string
}

/** Per review mode: where its findings go back to, and what they become there. */
export const SEND_BACK_RULES: Record<string, SendBackRule> = {
  prreview: {
    upstreamMode: 'standard',
    type: 'bug',
    agency: 'afk',
    acceptanceCriteria: ['What the finding describes no longer stands in this build\'s code, and a test covers it where it is about behaviour'],
    instruction: 'Fix it on this build\'s integration branch, so its roll-up PR carries the fix; then rerun the review.',
  },
  // A plan review's findings are questions about the plan, settled the way a
  // plan settles everything: a decision ticket the human grills and resolves.
  planreview: {
    upstreamMode: 'plan',
    type: 'decision',
    agency: 'hitl',
    acceptanceCriteria: ['The decision is made and written in this ticket\'s resolution, and the spec and the ticket plan are revised to match'],
    instruction: 'Decide it on this plan (grill it, write the decision in the resolution), revise the spec and the ticket plan to match, then rerun the plan review.',
  },
}

// ── Which upstream a review node reviews ────────────────────────────────────

export interface UpstreamProject {
  id: string
  key: string
  title: string
  mode: string
  integrationBranch: string
}

export interface ReviewedUpstream<P extends UpstreamProject> {
  /** The project findings go back to / whose roll-up PR is attached; null when there is no clear one. */
  target: P | null
  /** Every real project of the right mode directly upstream of the node, in node order. */
  candidates: P[]
  /** Why there is no target — '' when there is one. */
  why: string
}

/**
 * The upstream project a review node reviews: a direct upstream of the
 * rule's mode (a build, for a PR review) that has a project. With several:
 *
 *   1. `prefer` — the human's pick (id or key), when it is one of them
 *   2. the build whose integration branch is the reviewed PR's head (`prHead`)
 *   3. the only one
 *   4. the latest slice: the one no other candidate is downstream of (a build
 *      stacked on another wins over the one it stacks on)
 *
 * else none — the caller asks the human to pick (`candidates`).
 */
export function reviewedUpstream<P extends UpstreamProject>(input: {
  graph: Pick<Graph, 'nodes' | 'edges'>
  nodeId: string
  projects: P[]
  upstreamMode: string
  prHead?: string
  prefer?: string
}): ReviewedUpstream<P> {
  const { graph, nodeId, projects, upstreamMode } = input
  const byId = new Map(projects.map((p) => [p.id, p]))
  const nodes = upstreamNodes(graph, nodeId, { mode: upstreamMode }).filter((n) => n.projectId && byId.has(n.projectId))
  const candidates = nodes.map((n) => byId.get(n.projectId!)!)
  const none = (why: string): ReviewedUpstream<P> => ({ target: null, candidates, why })
  if (!candidates.length) return none('nothing of the right type sits directly before this review in its graph')

  const prefer = (input.prefer ?? '').trim()
  if (prefer) {
    const hit = candidates.find((p) => p.id === prefer || p.key.toUpperCase() === prefer.toUpperCase())
    return hit ? { target: hit, candidates, why: '' } : none(`${prefer} is not directly before this review — pick one of ${candidates.map((p) => p.key).join(', ')}`)
  }
  const head = (input.prHead ?? '').trim()
  const byHead = head ? candidates.filter((p) => p.integrationBranch.trim() === head) : []
  if (byHead.length === 1) return { target: byHead[0]!, candidates, why: '' }
  if (candidates.length === 1) return { target: candidates[0]!, candidates, why: '' }

  const ancestors = new Map(nodes.map((n) => [n.id, new Set(upstreamNodes(graph, n.id, { transitive: true }).map((u) => u.id))]))
  const latest = nodes.filter((n) => !nodes.some((m) => m.id !== n.id && ancestors.get(m.id)!.has(n.id)))
  if (latest.length === 1) return { target: byId.get(latest[0]!.projectId!)!, candidates, why: '' }
  return none(`${candidates.map((p) => p.key).join(', ')} all lead into this review — pick the one to send findings back to`)
}

// ── In: the roll-up PR a new review project attaches ────────────────────────

/** The roll-up PR fact the decision reads (server/utils/graphs.ts readRollup). */
export interface RollupLookup {
  state: 'open' | 'merged' | 'closed' | 'none' | 'no-branch' | 'unknown'
  number?: number
}

/**
 * Whether a new review project, made by entering a proposed Review node,
 * attaches the reviewed build's roll-up PR: only an OPEN one. Otherwise it is
 * made with no PR yet (its page is the PR picker) and `note` says why.
 */
export function rollupToAttach(build: Pick<UpstreamProject, 'key' | 'integrationBranch'> | null, rollup: RollupLookup | null, whyNoBuild = ''): { pr: number | null; note: string } {
  const pick = ' — pick the PR on the review\'s page.'
  if (!build) return { pr: null, note: whyNoBuild ? `No build to review: ${whyNoBuild}${pick}` : '' }
  if (!build.integrationBranch.trim()) return { pr: null, note: `${build.key} has no integration branch yet, so no roll-up PR${pick}` }
  switch (rollup?.state ?? 'unknown') {
    case 'open':
      return rollup!.number ? { pr: rollup!.number, note: '' } : { pr: null, note: `GitHub named no number for ${build.key}'s roll-up PR${pick}` }
    case 'merged':
      return { pr: null, note: `${build.key}'s roll-up PR #${rollup!.number} is already merged${pick}` }
    case 'closed':
      return { pr: null, note: `${build.key}'s roll-up PR #${rollup!.number} is closed${pick}` }
    case 'none':
    case 'no-branch':
      return { pr: null, note: `${build.key} has no roll-up PR open on GitHub yet${pick}` }
    default:
      return { pr: null, note: `GitHub couldn't say whether ${build.key} has a roll-up PR open${pick}` }
  }
}

// ── Out: send back ──────────────────────────────────────────────────────────

/** A ticket on the review project, as the planner reads it. */
export interface SendBackSource {
  id: string
  key: string
  title: string
  description: string
  labels: readonly string[]
  finding?: TicketFinding
  sentBack?: TicketSentBack | null
}

export interface SendBackPlan<S extends SendBackSource> {
  /** Findings to send: each gets a new ticket. */
  send: S[]
  /** Findings already sent, with the ticket they became — nothing new is filed. */
  already: Array<{ key: string; ticketKey: string }>
  /** Picked keys that can't be sent, and why. */
  refused: Array<{ key: string; why: string }>
}

/**
 * What a Send back press does with the picked keys. `tickets` are the review
 * project's tickets; `ticketExists` says whether a recorded ticket is still
 * there (one the human deleted can be sent again). Only finding tickets go
 * back; a key picked twice counts once.
 */
export function planSendBack<S extends SendBackSource>(input: { keys: readonly string[]; tickets: S[]; ticketExists: (id: string) => boolean; projectKey: string }): SendBackPlan<S> {
  const plan: SendBackPlan<S> = { send: [], already: [], refused: [] }
  const byKey = new Map(input.tickets.map((t) => [t.key.toUpperCase(), t]))
  const seen = new Set<string>()
  for (const raw of input.keys) {
    const key = String(raw).trim().toUpperCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    const t = byKey.get(key)
    if (!t) plan.refused.push({ key, why: `not a ticket on ${input.projectKey}` })
    else if (!isFindingTicket(t)) plan.refused.push({ key: t.key, why: 'not a review finding — only findings are sent back' })
    else if (t.sentBack && input.ticketExists(t.sentBack.ticketId)) plan.already.push({ key: t.key, ticketKey: t.sentBack.ticketKey })
    else plan.send.push(t)
  }
  return plan
}

/** The footer an agreement review writes on a finding ticket ("A record, not work: …") — wrong on the ticket it becomes. */
const RECORD_FOOTER = /\n-{3,}\n+A record, not work:[\s\S]*$/

/**
 * The ticket a finding becomes on the upstream project: the finding's title,
 * its description without the record-only footer (with the file and line in
 * front when the description doesn't name them), and a link back to the
 * finding ticket and its review project. `base` is jTicket's public URL.
 */
export function sendBackDraft(
  source: SendBackSource,
  ctx: { rule: SendBackRule; review: { key: string; title: string }; base: string },
): { title: string; description: string; acceptanceCriteria: string[]; type: string; labels: string[] } {
  const f = source.finding
  let body = source.description.replace(RECORD_FOOTER, '').trim()
  if (f?.file && !body.includes(f.file)) body = `**Where:** ${findingWhere(f)}\n\n${body}`.trim()
  const { base, review, rule } = ctx
  const footer =
    `Sent back from [${source.key}](${base}/tickets/${source.key}), a finding of the review [${review.key} · ${review.title}](${base}/projects/${review.key}?tab=review). ` +
    rule.instruction
  return {
    title: source.title,
    description: [body, '', '---', footer].join('\n').trim(),
    acceptanceCriteria: [...rule.acceptanceCriteria],
    type: rule.type,
    labels: [rule.agency, SENT_BACK_LABEL, ...(f ? [`severity:${f.severity}`, `category:${f.category}`] : source.labels.filter((l) => /^(severity|category):/.test(l)))],
  }
}
