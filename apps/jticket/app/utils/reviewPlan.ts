// PR review projects — a jTicket project pointed at one GitHub pull request
// (mode 'prreview'), whose job is to review that PR, never to change it.
//
// It has its OWN run setup, the review plan — separate from the Run setup
// tab's run plans (app/utils/runPlan.ts) and the auto loop, which stay exactly
// as they are. A review plan is short and fixed in shape:
//
//   checks   check tickets (labelled `pr:check`) run against the PR head,
//            each in its own session (`/jpr-check`), up to CHECK_SESSIONS_MAX
//            at once: tests, build, a stress script, a migration dry-run —
//            whatever the assessor decided the PR needs. Read-only: a check
//            records its verdict on the ticket and never commits or pushes
//   gate     waits for the human's Continue
//   review   ONE agreement review in jReview over the PR's diff: 2–4
//            reviewers, every one given the same brief (a doc the assessor
//            wrote), then a consensus session keeps what every reviewer
//            raised, has each finding adversarially verified, judges
//            approvability, and hands the findings back to the Review tab —
//            never to GitHub. As they land the server files each one on this
//            project as a record-only ticket (app/utils/reviewFindings.ts): a
//            rerun matches the open ones instead of duplicating them, and
//            nothing ever dispatches one. The last step, always
//
// The plan is written by one Fable 5.2 session (`/jreview-assess`, the
// `prreview:assess` hand-off) that reads the PR and decides how many
// reviewers, what they focus on, and whether checks are worth running. The
// human can edit it in the Review setup tab, then Start; Rerun refreshes the
// PR head, reopens the checks and runs it again.
//
// The runner (server/utils/reviewRun.ts, ticked by server/plugins/reviewRun.ts)
// asks reviewRunStep below what to do next. Pure: no Nuxt, no I/O —
// tests/reviewPlan.test.ts.
import { coercePlanModel, coerceEffort, type Effort, type PlanModel } from './runPlan'
import { isFindingTicket } from './reviewFindings'

// ── The PR ──────────────────────────────────────────────────────────────────

/** The pull request a PR review project reviews, as `gh pr view` last reported it. */
export interface PrInfo {
  number: number
  title: string
  url: string
  author: string
  headRefName: string
  baseRefName: string
  isDraft: boolean
  /** OPEN | CLOSED | MERGED */
  state: string
  /** The PR head when it was last fetched — what the project's branch points at. */
  headSha: string
  fetchedAt: string
}

/** The local branch a PR review project keeps the PR head on — its integration branch. Never pushed. */
export const prBranchName = (n: number) => `jreview/pr-${n}`

// ── The assessment ──────────────────────────────────────────────────────────

export const REVIEW_REVIEWERS_MIN = 2
export const REVIEW_REVIEWERS_MAX = 4
export type PrRisk = 'low' | 'medium' | 'high'

/** What the assessor decided, as it reported back. */
export interface PrAssessment {
  reviewers: number
  /** The areas the brief points every reviewer at. */
  focus: string[]
  /** The brief every reviewer reads first (DOC-n, labelled `review:brief`). */
  briefDoc: string
  /** Why this many reviewers, these focus areas and these checks — a short paragraph. */
  rationale: string
  risk: PrRisk
  assessedAt: string
}

/** A /jreview-assess session at work — set on dispatch, cleared when it reports back or is cancelled. */
export interface PrAssessing {
  agent: string
  paneId: string
  startedAt: string
  /** Start the review plan as soon as the assessment lands (when it has no problems). */
  autoStart: boolean
}

// ── The plan ────────────────────────────────────────────────────────────────

export type ReviewStepKind = 'checks' | 'gate' | 'review'

export interface ReviewPlanStep {
  /** Stable within the plan: 'r1', 'r2', … */
  id: string
  kind: ReviewStepKind
  /** checks: the check tickets, in the order they start. */
  tickets: string[]
  /** checks: model/effort per ticket (default CHECK_RUNNER). */
  runners: Record<string, { model: PlanModel; effort: Effort }>
  /** review: 2…4 reviewers, all on the same brief. */
  reviewers: number
  /** review: the reviewers' model and effort. */
  model: PlanModel
  effort: Effort
  /** review: adversarially verify every agreed finding before it comes back. */
  verify: boolean
  /** gate: what the human is asked to look at. */
  note: string
}

export interface ReviewPlan {
  steps: ReviewPlanStep[]
}

export const CHECK_RUNNER = { model: 'opus' as PlanModel, effort: 'medium' as Effort }
export const REVIEW_RUNNER = { model: 'opus' as PlanModel, effort: 'high' as Effort }
/** Check sessions running at once — the run plan's concurrency rule's own-agent ceiling. */
export const CHECK_SESSIONS_MAX = 4
/** The label every check ticket carries. */
export const CHECK_LABEL = 'pr:check'

const KINDS: ReviewStepKind[] = ['checks', 'gate', 'review']
const str = (v: unknown) => (typeof v === 'string' ? v : '')
const KEY = /^[A-Za-z][A-Za-z0-9]*-\d+$/

export function clampReviewers(n: unknown): number {
  const v = Number(n)
  return Number.isInteger(v) ? Math.min(REVIEW_REVIEWERS_MAX, Math.max(REVIEW_REVIEWERS_MIN, v)) : REVIEW_REVIEWERS_MIN
}

/** Whatever came off the wire or the disk, made safe — null when there's nothing usable. */
export function coerceReviewPlan(raw: any): ReviewPlan | null {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.steps)) return null
  const seen = new Set<string>()
  const steps: ReviewPlanStep[] = []
  for (const s of raw.steps) {
    if (!s || typeof s !== 'object' || !KINDS.includes(s.kind)) continue
    let id = str(s.id).trim().slice(0, 40)
    if (!id || seen.has(id)) {
      let n = steps.length + 1
      while (seen.has(`r${n}`)) n++
      id = `r${n}`
    }
    seen.add(id)
    const tickets = s.kind === 'checks' && Array.isArray(s.tickets) ? [...new Set<string>(s.tickets.filter((k: unknown): k is string => typeof k === 'string' && KEY.test(k)))] : []
    const runners: ReviewPlanStep['runners'] = {}
    if (s.kind === 'checks' && s.runners && typeof s.runners === 'object') {
      for (const [k, r] of Object.entries<any>(s.runners)) {
        if (!tickets.includes(k) || !r || typeof r !== 'object') continue
        runners[k] = { model: coercePlanModel(r.model) ?? CHECK_RUNNER.model, effort: coerceEffort(r.effort) ?? CHECK_RUNNER.effort }
      }
    }
    steps.push({
      id,
      kind: s.kind,
      tickets,
      runners,
      reviewers: s.kind === 'review' ? clampReviewers(s.reviewers) : REVIEW_REVIEWERS_MIN,
      model: (s.kind === 'review' && coercePlanModel(s.model)) || REVIEW_RUNNER.model,
      effort: (s.kind === 'review' && coerceEffort(s.effort)) || REVIEW_RUNNER.effort,
      verify: s.kind === 'review' ? s.verify !== false : true,
      note: s.kind === 'gate' ? str(s.note).trim().slice(0, 300) : '',
    })
  }
  return { steps }
}

/** The plan with just a review — what a PR with nothing worth checking gets. */
export function reviewOnlyPlan(reviewers: number): ReviewPlan {
  return coerceReviewPlan({ steps: [{ id: 'r1', kind: 'review', reviewers }] })!
}

export interface ReviewPlanTicket {
  key: string
  status: 'todo' | 'in_progress' | 'done' | 'merged'
  labels: string[]
}

export interface ReviewPlanProblem {
  stepId: string
  message: string
}

/** Everything that stops the plan from running — [] when it can. `tickets` are the project's. */
export function reviewPlanProblems(plan: ReviewPlan, tickets: ReviewPlanTicket[]): ReviewPlanProblem[] {
  const problems: ReviewPlanProblem[] = []
  const byKey = new Map(tickets.map((t) => [t.key, t]))
  const reviews = plan.steps.filter((s) => s.kind === 'review')
  if (!reviews.length) problems.push({ stepId: '', message: 'The plan has no review step — every review plan ends with one.' })
  if (reviews.length > 1) problems.push({ stepId: reviews[1]!.id, message: 'A review plan has one review step.' })
  const last = plan.steps.at(-1)
  if (reviews.length && last?.kind !== 'review') problems.push({ stepId: last?.id ?? '', message: 'The review step is the last step — move it to the end.' })
  const placed = new Set<string>()
  plan.steps.forEach((s, i) => {
    if (s.kind !== 'checks') return
    if (!s.tickets.length) problems.push({ stepId: s.id, message: `Step ${i + 1} has no checks.` })
    for (const k of s.tickets) {
      const t = byKey.get(k)
      if (!t) problems.push({ stepId: s.id, message: `${k} is not one of this project's tickets.` })
      else if (isFindingTicket(t)) problems.push({ stepId: s.id, message: `${k} is a review finding — a record-only ticket, never run as a check.` })
      else if (!t.labels.includes(CHECK_LABEL)) problems.push({ stepId: s.id, message: `${k} is not a check ticket (label \`${CHECK_LABEL}\`).` })
      if (placed.has(k)) problems.push({ stepId: s.id, message: `${k} is in the plan twice — a check runs once.` })
      placed.add(k)
    }
  })
  return problems
}

/** Every check ticket the plan runs, in order — what the reviewers read first. */
export const planChecks = (plan: ReviewPlan) => plan.steps.flatMap((s) => (s.kind === 'checks' ? s.tickets : []))

/** One line per step — the setup tab's headings and the run strip. */
export function reviewStepSummary(s: ReviewPlanStep): string {
  if (s.kind === 'checks') return `Checks · ${s.tickets.join(', ') || 'none'}`
  if (s.kind === 'gate') return s.note ? `Gate · ${s.note}` : 'Gate'
  return `Review · ${s.reviewers} reviewers${s.verify ? ' · verified' : ''}`
}

// ── A run ───────────────────────────────────────────────────────────────────

export type ReviewRunStatus = 'running' | 'paused' | 'done' | 'stopped'

export interface ReviewRun {
  /** 1-based: the project's nth run of its plan. */
  n: number
  status: ReviewRunStatus
  /** The plan as it was when the run started — edits to project.prReview.plan don't touch a running run. */
  plan: ReviewPlan
  cursor: number
  /** The PR head the run reviews. */
  headSha: string
  startedAt: string
  stepStartedAt: string
  endedAt: string
  /** checks: ticketKey → when its session was dispatched. */
  dispatched: Record<string, string>
  /** review: when jReview was asked ('' = not yet), and its key. */
  reviewRequestedAt: string
  reviewKey: string
  gatePassed: boolean
  /** Why the run is paused ('' = it isn't). */
  pausedFor: string
}

/** A finished (or stopped) run, newest last. */
export interface ReviewRunRecord {
  n: number
  status: ReviewRunStatus
  headSha: string
  reviewKey: string
  verdict?: string
  startedAt: string
  endedAt: string
}

export function newReviewRun(n: number, plan: ReviewPlan, headSha: string, at: string): ReviewRun {
  return {
    n,
    status: 'running',
    plan: structuredClone(plan),
    cursor: 0,
    headSha,
    startedAt: at,
    stepStartedAt: at,
    endedAt: '',
    dispatched: {},
    reviewRequestedAt: '',
    reviewKey: '',
    gatePassed: false,
    pausedFor: '',
  }
}

export function coerceReviewRun(raw: any): ReviewRun | null {
  if (!raw || typeof raw !== 'object') return null
  const plan = coerceReviewPlan(raw.plan)
  if (!plan) return null
  const statuses: ReviewRunStatus[] = ['running', 'paused', 'done', 'stopped']
  return {
    n: Number.isInteger(raw.n) && raw.n > 0 ? raw.n : 1,
    status: statuses.includes(raw.status) ? raw.status : 'stopped',
    plan,
    cursor: Number.isInteger(raw.cursor) && raw.cursor >= 0 ? raw.cursor : 0,
    headSha: str(raw.headSha),
    startedAt: str(raw.startedAt),
    stepStartedAt: str(raw.stepStartedAt),
    endedAt: str(raw.endedAt),
    dispatched: raw.dispatched && typeof raw.dispatched === 'object' ? Object.fromEntries(Object.entries(raw.dispatched).filter(([, v]) => typeof v === 'string')) as Record<string, string> : {},
    reviewRequestedAt: str(raw.reviewRequestedAt),
    reviewKey: str(raw.reviewKey),
    gatePassed: raw.gatePassed === true,
    pausedFor: str(raw.pausedFor),
  }
}

/** A check session silent this long with its ticket open → the run pauses (Retry re-dispatches it). */
export const CHECK_STALL_MS = 60 * 60_000
/** A review with no hand-back this long after it was asked for → the run pauses. */
export const REVIEW_RUN_STALL_MS = 90 * 60_000

export interface ReviewRunWorld {
  now: number
  /** The project's tickets. */
  tickets: Array<{ key: string; status: string }>
  /** The run's review: its status, or 'missing' when the review store no longer has it. */
  review: null | 'missing' | { status: 'reviewing' | 'triaging' | 'triaged' | 'ticketed'; verdict?: string }
}

export type ReviewRunStep =
  | { kind: 'none' }
  | { kind: 'wait'; note: string }
  | { kind: 'dispatchChecks'; keys: string[] }
  | { kind: 'startReview' }
  | { kind: 'advance' }
  | { kind: 'finish'; verdict?: string }
  | { kind: 'pause'; detail: string }

const finishedStatus = (s: string | undefined) => s === 'done' || s === 'merged'

/** What the runner does next for `run`. */
export function reviewRunStep(run: ReviewRun, world: ReviewRunWorld): ReviewRunStep {
  if (run.status !== 'running') return { kind: 'none' }
  const step = run.plan.steps[run.cursor]
  if (!step) return { kind: 'finish' }
  const age = world.now - Date.parse(run.stepStartedAt || run.startedAt)
  const mins = `${Math.round(age / 60_000)} min`
  switch (step.kind) {
    case 'checks': {
      const status = (k: string) => world.tickets.find((t) => t.key === k)?.status
      const open = step.tickets.filter((k) => !finishedStatus(status(k)))
      if (!open.length) return { kind: 'advance' }
      const running = open.filter((k) => run.dispatched[k]).length
      const free = Math.max(0, CHECK_SESSIONS_MAX - running)
      const next = open.filter((k) => !run.dispatched[k]).slice(0, free)
      if (next.length) return { kind: 'dispatchChecks', keys: next }
      if (age > CHECK_STALL_MS) return { kind: 'pause', detail: `checks ${open.join(', ')} still open after ${mins} — look at their panes, then Retry (re-dispatches them)` }
      const queued = open.filter((k) => !run.dispatched[k])
      return { kind: 'wait', note: `checking ${open.filter((k) => run.dispatched[k]).join(', ')}${queued.length ? ` · ${queued.join(', ')} queued` : ''}` }
    }
    case 'gate':
      return run.gatePassed ? { kind: 'advance' } : { kind: 'wait', note: `gate — press Continue when you're ready${step.note ? `: ${step.note}` : ''}` }
    case 'review': {
      if (!run.reviewRequestedAt) return { kind: 'startReview' }
      if (!run.reviewKey) {
        // The request is in flight (jReview cuts a worktree first) — give it a minute.
        return world.now - Date.parse(run.reviewRequestedAt) > 2 * 60_000
          ? { kind: 'pause', detail: 'jReview was asked for the review but its key never came back — Retry asks again' }
          : { kind: 'wait', note: 'asking jReview for the review' }
      }
      if (world.review === 'missing' || !world.review) return { kind: 'pause', detail: `jReview no longer has review ${run.reviewKey} — Retry starts a new one` }
      if (world.review.status === 'triaged' || world.review.status === 'ticketed') return { kind: 'finish', verdict: world.review.verdict }
      if (age > REVIEW_RUN_STALL_MS) return { kind: 'pause', detail: `review ${run.reviewKey} has had no hand-back for ${mins} — look at its panes, then Retry starts a new one` }
      return { kind: 'wait', note: world.review.status === 'reviewing' ? `review ${run.reviewKey}: reviewers at work` : `review ${run.reviewKey}: consensus and verification` }
    }
  }
}

/** The run moves on to its next step. */
export function advanceReviewRun(run: ReviewRun, at: string): ReviewRun {
  return { ...run, cursor: run.cursor + 1, stepStartedAt: at, dispatched: {}, gatePassed: false }
}

/** Retry the paused step: un-dispatch its open checks, or forget its review request. */
export function retryReviewRun(run: ReviewRun, at: string, openTickets: string[]): ReviewRun {
  const step = run.plan.steps[run.cursor]
  const dispatched = { ...run.dispatched }
  if (step?.kind === 'checks') for (const k of openTickets) delete dispatched[k]
  return {
    ...run,
    status: 'running',
    pausedFor: '',
    stepStartedAt: at,
    dispatched,
    ...(step?.kind === 'review' ? { reviewRequestedAt: '', reviewKey: '' } : {}),
  }
}

/** The record a finished or stopped run leaves behind. */
export function reviewRunRecord(run: ReviewRun, verdict?: string): ReviewRunRecord {
  return { n: run.n, status: run.status, headSha: run.headSha, reviewKey: run.reviewKey, ...(verdict ? { verdict } : {}), startedAt: run.startedAt, endedAt: run.endedAt }
}

// ── The whole PR review record (project.prReview) ───────────────────────────

export interface PrReview {
  pr: PrInfo
  assessment: PrAssessment | null
  assessing: PrAssessing | null
  plan: ReviewPlan | null
  run: ReviewRun | null
  runs: ReviewRunRecord[]
}

export const REVIEW_RUNS_CAP = 20

export function coercePrReview(raw: any): PrReview | null {
  if (!raw || typeof raw !== 'object' || !raw.pr || !Number.isInteger(raw.pr.number)) return null
  const p = raw.pr
  const a = raw.assessment
  const g = raw.assessing
  return {
    pr: {
      number: p.number,
      title: str(p.title),
      url: str(p.url),
      author: str(p.author),
      headRefName: str(p.headRefName),
      baseRefName: str(p.baseRefName),
      isDraft: p.isDraft === true,
      state: str(p.state) || 'OPEN',
      headSha: str(p.headSha),
      fetchedAt: str(p.fetchedAt),
    },
    assessment:
      a && typeof a === 'object'
        ? {
            reviewers: clampReviewers(a.reviewers),
            focus: Array.isArray(a.focus) ? a.focus.map(str).map((f: string) => f.trim().slice(0, 200)).filter(Boolean).slice(0, 12) : [],
            briefDoc: KEY.test(str(a.briefDoc)) ? str(a.briefDoc) : '',
            rationale: str(a.rationale).slice(0, 4000),
            risk: a.risk === 'low' || a.risk === 'high' ? a.risk : 'medium',
            assessedAt: str(a.assessedAt),
          }
        : null,
    assessing: g && typeof g === 'object' && str(g.agent) ? { agent: str(g.agent), paneId: str(g.paneId), startedAt: str(g.startedAt), autoStart: g.autoStart !== false } : null,
    plan: coerceReviewPlan(raw.plan),
    run: coerceReviewRun(raw.run),
    runs: Array.isArray(raw.runs) ? raw.runs.filter((r: any) => r && typeof r === 'object').slice(-REVIEW_RUNS_CAP) : [],
  }
}

// ── The Reviews board ───────────────────────────────────────────────────────
// PR review projects live on their own board (/reviews), not the projects
// board, the home board, Today or Graphs. These are what it reads.

/** A PR review project — the projects board, home board, Today and Graphs leave these out. */
export const isReviewProject = (p: { mode?: string } | null | undefined) => p?.mode === 'prreview'

export type PrReviewRunState = 'assessing' | 'running' | 'paused' | 'idle'

/** What the project is doing right now: assessing, a run in flight (or paused), or nothing. */
export function prReviewRunState(r: PrReview | null | undefined): PrReviewRunState {
  if (r?.assessing) return 'assessing'
  if (r?.run?.status === 'running') return 'running'
  if (r?.run?.status === 'paused') return 'paused'
  return 'idle'
}

/** The verdict of the last run that finished with one ('' = none yet). */
export function prReviewVerdict(r: PrReview | null | undefined): string {
  return [...(r?.runs ?? [])].reverse().find((x) => x.status === 'done' && x.verdict)?.verdict ?? ''
}

/**
 * A review project is done when its PR is merged or closed, or its last run
 * finished — never from ticket counts (its check tickets close long before the
 * review does). Assessing or a run in flight (a Rerun) is never done.
 */
export function prReviewDone(r: PrReview | null | undefined): boolean {
  if (!r) return false
  const state = r.pr.state.toUpperCase()
  if (state === 'MERGED' || state === 'CLOSED') return true
  if (prReviewRunState(r) !== 'idle') return false
  return r.runs.at(-1)?.status === 'done'
}
