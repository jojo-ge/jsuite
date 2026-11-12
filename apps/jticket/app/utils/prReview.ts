// PR review projects — a jTicket project pointed at one GitHub pull request
// (mode 'prreview'), whose job is to review that PR, never to change it.
//
// There is no plan and no setup: the project's Review tab starts ONE
// agreement review of the PR's diff (POST /api/projects/:id/reviews) — 2–4
// reviewers, then a consensus session that keeps what every reviewer raised,
// has each finding adversarially verified, judges approvability and writes
// the summary. The server files each finding on the project as a record-only
// ticket (app/utils/reviewFindings.ts); the human reads the verdict and the
// summary in the Review tab and posts what they pick to the PR. Starting
// again (Rerun) re-fetches the PR head first, and matches the open finding
// tickets rather than duplicating them.
//
// What the project remembers is the PR and one record per review it started
// (`runs`). Pure: no Nuxt, no I/O — tests/reviewsBoard.test.ts.
import type { Effort, PlanModel } from './runPlan'

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

// ── The review ──────────────────────────────────────────────────────────────

/** An agreement review needs two reviewers to agree on anything; four is the engine's ceiling. */
export const REVIEW_REVIEWERS_MIN = 2
export const REVIEW_REVIEWERS_MAX = 4
export const REVIEW_REVIEWERS_DEFAULT = 3
/** The reviewers' model and effort. */
export const REVIEW_RUNNER = { model: 'opus' as PlanModel, effort: 'high' as Effort }

/** The reviewer count a start asked for — the default when it asked for none, null when it isn't 2…4. */
export function reviewerCount(n: unknown): number | null {
  if (n === undefined || n === null || n === '') return REVIEW_REVIEWERS_DEFAULT
  const v = Number(n)
  return Number.isInteger(v) && v >= REVIEW_REVIEWERS_MIN && v <= REVIEW_REVIEWERS_MAX ? v : null
}

// ── The reviews a project started ───────────────────────────────────────────

/** running: its review is still out. done: findings and verdict are back. stopped: the review was forgotten, or never came back. */
export type PrReviewRunStatus = 'running' | 'done' | 'stopped'

/** One review of the PR, oldest first on the project. */
export interface PrReviewRun {
  /** 1-based: the project's nth review. */
  n: number
  status: PrReviewRunStatus
  /** The PR head it reviewed. */
  headSha: string
  /** The review's key (its room is /reviews/<key>). */
  reviewKey: string
  /** The consensus session's approvability verdict, once it is back. */
  verdict?: string
  startedAt: string
  endedAt: string
}

/** The whole PR review record (project.prReview). */
export interface PrReview {
  pr: PrInfo
  runs: PrReviewRun[]
}

export const REVIEW_RUNS_CAP = 20

const str = (v: unknown) => (typeof v === 'string' ? v : '')

function coerceRun(raw: any, status: PrReviewRunStatus): PrReviewRun {
  return {
    n: Number.isInteger(raw.n) && raw.n > 0 ? raw.n : 1,
    status,
    headSha: str(raw.headSha),
    reviewKey: str(raw.reviewKey),
    ...(str(raw.verdict) ? { verdict: str(raw.verdict) } : {}),
    startedAt: str(raw.startedAt),
    endedAt: str(raw.endedAt),
  }
}

/** Whatever came off the wire or the disk, made safe — null when it names no PR. */
export function coercePrReview(raw: any): PrReview | null {
  if (!raw || typeof raw !== 'object' || !raw.pr || !Number.isInteger(raw.pr.number)) return null
  const p = raw.pr
  const runs: PrReviewRun[] = (Array.isArray(raw.runs) ? raw.runs : [])
    .filter((r: any) => r && typeof r === 'object')
    // 'paused' is from when a review plan ran these: a paused run never finished.
    .map((r: any) => coerceRun(r, r.status === 'running' || r.status === 'done' ? r.status : 'stopped'))
  // A record from when a review plan ran the review: its run in flight was
  // kept apart from the finished ones. One whose review had started carries on
  // as a running review; one still on its checks has nothing left to wait for.
  const live = raw.run
  if (live && typeof live === 'object' && (live.status === 'running' || live.status === 'paused') && str(live.reviewKey) && !runs.some((r) => r.reviewKey === live.reviewKey)) {
    runs.push(coerceRun(live, 'running'))
  }
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
    runs: runs.slice(-REVIEW_RUNS_CAP),
  }
}

/** What settleRun reads of a run — a PR review's, or a plan review's (app/utils/planReview.ts). */
export interface SettleableRun {
  status: PrReviewRunStatus
  reviewKey: string
  verdict?: string
  endedAt: string
}

/**
 * The runs with the review `reviewKey` settled: `done` (its findings and
 * verdict came back — a re-POST settles it again with the new verdict) or
 * `stopped` (it was forgotten; only a run still out stops). The same array
 * when nothing changed.
 */
export function settleRun<R extends SettleableRun>(runs: R[], reviewKey: string, to: 'done' | 'stopped', at: string, verdict?: string): R[] {
  const i = runs.findIndex((r) => r.reviewKey === reviewKey)
  const run = runs[i]
  if (!run || (to === 'stopped' && run.status !== 'running')) return runs
  const { verdict: _was, ...rest } = run
  const next = { ...rest, status: to, endedAt: run.status === 'running' ? at : run.endedAt || at, ...(to === 'done' && verdict ? { verdict } : {}) } as R
  return runs.map((r, j) => (j === i ? next : r))
}

// ── The Reviews board ───────────────────────────────────────────────────────
// Review projects — PR reviews and plan reviews (app/utils/planReview.ts) —
// live on their own board (/reviews), not the projects board, the home
// board, Today or Graphs' boards. These are what it reads.

/** A review project (a PR review or a plan review) — the projects board, home board and Today leave these out. */
export const isReviewProject = (p: { mode?: string } | null | undefined) => p?.mode === 'prreview' || p?.mode === 'planreview'

/**
 * A PR review project made from the create modal starts with no pull request:
 * its page is only the PR picker until one is attached (POST
 * /api/projects/:id/pr-review {pr}), and it has no branch and no reviews.
 */
export const reviewNeedsPr = (p: { mode?: string; prReview?: unknown } | null | undefined) => p?.mode === 'prreview' && !p?.prReview

/** What a review project is called until its pull request names it. */
export const UNATTACHED_REVIEW_TITLE = 'New review'

export type PrReviewRunState = 'running' | 'idle'

/** What the project is doing right now: a review out, or nothing. */
export function prReviewRunState(r: PrReview | null | undefined): PrReviewRunState {
  return r?.runs.at(-1)?.status === 'running' ? 'running' : 'idle'
}

/** The verdict of the last review that came back with one ('' = none yet). */
export function prReviewVerdict(r: PrReview | null | undefined): string {
  return [...(r?.runs ?? [])].reverse().find((x) => x.status === 'done' && x.verdict)?.verdict ?? ''
}

/**
 * A review project is done when its PR is merged or closed, or its last
 * review came back — never from ticket counts (finding tickets stay open
 * until the author deals with them). A review still out (a Rerun) is never done.
 */
export function prReviewDone(r: PrReview | null | undefined): boolean {
  if (!r) return false
  const state = r.pr.state.toUpperCase()
  if (state === 'MERGED' || state === 'CLOSED') return true
  return r.runs.at(-1)?.status === 'done'
}
