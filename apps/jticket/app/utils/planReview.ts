// Plan review projects — a jTicket project pointed at one plan project (mode
// 'planreview', shown as "Plan review"), whose job is to review that plan's
// spec and ticket plan before its builds run, never to change it.
//
// It is the PR review project's sibling (app/utils/prReview.ts) and runs on
// the same engine: its Review tab starts ONE agreement review — 2–4 reviewers,
// then a consensus session that keeps what every reviewer raised, verifies
// each finding and judges whether the builds can run as planned — with the
// review's subject set to the plan (ReviewSubject in reviewTypes.ts): no diff,
// no branch, no worktree. Each reviewer reads the plan through jTicket (its
// map, resolved tickets, docs — the spec among them — and the ticket plan)
// and the code read-only in the main checkout, following /jplan-review. The
// findings land on this project as record-only tickets; Send back turns the
// ones the human picks into decision tickets on the plan
// (SEND_BACK_RULES.planreview in reviewHandoff.ts).
//
// What the project remembers is the plan it reviews and one record per review
// it started (`runs`). Pure: no Nuxt, no I/O — tests/planReview.test.ts. The
// store side is server/utils/planReview.ts.
import { REVIEW_REVIEWERS_MAX, REVIEW_REVIEWERS_MIN, REVIEW_RUNS_CAP, reviewerCount, type PrReviewRunStatus } from './prReview'
import type { Review } from './reviewTypes'

/** One review of the plan, oldest first on the project. */
export interface PlanReviewRun {
  /** 1-based: the project's nth review. */
  n: number
  status: PrReviewRunStatus
  /** The review's key (its room is /reviews/<key>). */
  reviewKey: string
  /** The consensus session's verdict, once it is back. */
  verdict?: string
  /** What the plan's ticket plan held when the review started — so a rerun's briefing can tell the plan moved on. */
  drafts: number
  builds: number
  startedAt: string
  endedAt: string
}

/** The whole plan review record (project.planReview). `planProjectId` '' = no plan picked yet (a graph node made it with no plan before it). */
export interface PlanReview {
  planProjectId: string
  runs: PlanReviewRun[]
}

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const count = (v: unknown) => (Number.isInteger(v) && (v as number) >= 0 ? (v as number) : 0)

/** Whatever came off the wire or the disk, made safe — null when it isn't a record at all. */
export function coercePlanReview(raw: any): PlanReview | null {
  if (!raw || typeof raw !== 'object') return null
  const runs: PlanReviewRun[] = (Array.isArray(raw.runs) ? raw.runs : [])
    .filter((r: any) => r && typeof r === 'object' && str(r.reviewKey))
    .map((r: any) => ({
      n: Number.isInteger(r.n) && r.n > 0 ? r.n : 1,
      status: r.status === 'running' || r.status === 'done' ? r.status : 'stopped',
      reviewKey: str(r.reviewKey),
      ...(str(r.verdict) ? { verdict: str(r.verdict) } : {}),
      drafts: count(r.drafts),
      builds: count(r.builds),
      startedAt: str(r.startedAt),
      endedAt: str(r.endedAt),
    }))
  return { planProjectId: str(raw.planProjectId), runs: runs.slice(-REVIEW_RUNS_CAP) }
}

/** A plan review project. */
export const isPlanReviewProject = (p: { mode?: string } | null | undefined) => p?.mode === 'planreview'

/** A plan review project with no plan picked yet: its Review tab asks for one first. */
export const planReviewNeedsPlan = (p: { mode?: string; planReview?: PlanReview | null } | null | undefined) =>
  isPlanReviewProject(p) && !p?.planReview?.planProjectId

/** What the project is doing right now: a review out, or nothing. */
export const planReviewRunState = (r: PlanReview | null | undefined): 'running' | 'idle' => (r?.runs.at(-1)?.status === 'running' ? 'running' : 'idle')

/** The verdict of the last review that came back with one ('' = none yet). */
export function planReviewVerdict(r: PlanReview | null | undefined): string {
  return [...(r?.runs ?? [])].reverse().find((x) => x.status === 'done' && x.verdict)?.verdict ?? ''
}

/** A plan review is done once its last review came back — never from ticket counts (finding tickets stay open until they are settled). */
export const planReviewDone = (r: PlanReview | null | undefined): boolean => r?.runs.at(-1)?.status === 'done'

// ── Starting a review ───────────────────────────────────────────────────────

/** What the plan holds, as the start decision reads it. */
export interface PlanUnderReview {
  key: string
  title: string
  mode: string
  repo: string
  /** Draft tickets of its ticket plan, and the builds (proposed or real) in it. */
  drafts: number
  builds: number
  /** Docs on the plan (the spec is one labelled `spec`). */
  docs: number
  /** A /jplan-to-jtickets session is still writing its ticket plan. */
  drafting: boolean
}

export interface StartRefusal {
  status: 400 | 404 | 409
  message: string
}

/**
 * Why Start review can't dispatch on this project, or null when it can. A
 * review still out is the caller's to check (it asks the review itself).
 * `plan` is null when the project names none, or the named one is gone.
 *
 * A plan with nothing to read — no ticket plan and no doc — is refused: three
 * Opus reviewers over an empty plan is money spent on nothing. A plan still
 * being drafted is refused too: the reviewers would read it half-written.
 */
export function planReviewStartProblem(input: {
  project: { key: string; mode: string; share?: { side: string } | null; planReview?: PlanReview | null }
  plan: PlanUnderReview | null
  reviewers?: unknown
}): StartRefusal | null {
  const { project, plan } = input
  if (project.mode !== 'planreview') return { status: 409, message: `${project.key} is not a plan review project` }
  if (project.share && project.share.side !== 'creator') return { status: 409, message: `${project.key} is shared with you — only its creator's side runs its review` }
  if (reviewerCount(input.reviewers) === null) {
    return { status: 400, message: `reviewers must be ${REVIEW_REVIEWERS_MIN}…${REVIEW_REVIEWERS_MAX} — an agreement review needs at least two to agree` }
  }
  if (!project.planReview?.planProjectId) return { status: 409, message: `${project.key} has no plan to review yet — pick one (POST /api/projects/${project.key}/plan-review {plan})` }
  if (!plan) return { status: 404, message: `the plan ${project.key} reviews is gone — pick another (POST /api/projects/${project.key}/plan-review {plan})` }
  if (plan.mode !== 'plan') return { status: 409, message: `${plan.key} is not a plan project — a plan review reads a plan's spec and ticket plan` }
  if (!plan.repo.trim()) return { status: 409, message: `${plan.key} has no repo — the reviewers read the code the plan changes; set the plan's repo first` }
  if (plan.drafting) return { status: 409, message: `a session is still drafting ${plan.key}'s ticket plan — review it once that session reports back` }
  if (!plan.drafts && !plan.builds && !plan.docs) {
    return { status: 409, message: `${plan.key} has no ticket plan and no docs yet — draft its ticket plan (its Ticket plan tab) before reviewing it` }
  }
  return null
}

// ── The reviewer's hand-off ─────────────────────────────────────────────────

/**
 * A plan review reviewer's prompt — the plan branch of reviewerPrompt
 * (server/utils/reviewHerdr.ts), which passes the report skill's path. One
 * line: herdr submits it as typed input. The slash command is the first
 * token, or claude never runs the skill.
 */
export function planReviewerPrompt(review: Pick<Review, 'key' | 'subject' | 'reviewers' | 'workdir' | 'project' | 'context'>, n: number, reportSkill: string): string {
  const r = review.reviewers.find((x) => x.n === n)!
  const plan = review.subject!.projectKey
  const title = (review.subject!.title || plan).replace(/[\r\n]+/g, ' ')
  const api = 'http://localhost:43000/api'
  return [
    `/jplan-review ${plan} — you are reviewer ${n} of the plan review ${review.key}: the jTicket plan project ${plan} ("${title}") and its ticket plan, before any of its builds run. Use the GLOBAL skill (~/.claude/skills/jplan-review).`,
    `There is no diff and no branch: read the plan through jTicket with jt — the project and its map (GET ${api}/projects/${plan}), its tickets with their resolutions, its docs (the spec is the one labelled spec; GET ${api}/docs?projectId=${plan}) and its ticket plan (GET ${api}/projects/${plan}/ticket-plan: the proposed builds and their notes, the draft tickets and blockers, the proposed reviews).`,
    `Read the code the plan changes in this checkout (${review.workdir}) — read-only: it is the codebase's main checkout, so read files and run read-only git commands, nothing that writes.`,
    ...(review.context?.brief
      ? [`Read the review brief first: jTicket doc ${review.context.brief} (GET ${api}/docs/${review.context.brief}) — its focus areas are where to look hardest, not the only places to look.`]
      : []),
    `Report only — never edit the plan, its tickets or its docs, never file tickets, never change the code; findings reach the plan only when the human sends them back from ${review.project ?? 'the plan review project'}.`,
    'Every finding names the build, ticket or decision it concerns. End with an approvability verdict — approve, approve-with-nits, request-changes or needs-discussion: whether the builds can run as planned — in the dump\'s APPROVAL line (the report skill says how).',
    'Work unattended: do not stop to ask questions — where the plan is silent, say so as a finding.',
    `When the review is complete, publish it: read ${reportSkill} and follow it with review=${review.key} reviewer=${n} doc=${r.docKey}.`,
  ].join(' ')
}

// ── The project ─────────────────────────────────────────────────────────────

/** What a new plan review project is called when nobody named it. */
export const planReviewTitle = (plan: { key: string; title: string }) => `Plan review · ${plan.key} ${plan.title}`.slice(0, 200)

/** A new plan review project's description: `note` (a graph node's reasoning) first, then how the project works. */
export function planReviewDescription(plan: { key: string; title: string } | null, note = ''): string {
  return [
    ...(note.trim() ? [note.trim(), ''] : []),
    plan
      ? `Review of the plan [${plan.key} — ${plan.title}](/projects/${plan.key}) — its spec and ticket plan — before its builds run.`
      : 'Review of a plan — its spec and ticket plan — before its builds run. Pick the plan on the Review tab.',
    '',
    'How this project works:',
    '1. **Start review** (Review tab): 2–4 reviewers each read the plan through jTicket — its map, decisions, spec and ticket plan — and the code it will change, read-only. A consensus session keeps only what every one of them raised, has each finding verified, and judges whether the builds can run as planned.',
    '2. **Your call** (Review tab): read the verdict and the findings — each one is a record-only ticket on this board — then **Send back** the ones you want: each becomes a decision ticket on the plan. Settle them there, revise the ticket plan, and Rerun.',
  ].join('\n')
}
