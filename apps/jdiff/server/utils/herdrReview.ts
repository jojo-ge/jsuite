// Driving Herdr (the terminal workspace manager) from jDiff.
//
// jDiff runs NO claude of its own: review guidance is produced by an
// interactive claude session dispatched into herdr (one workspace per
// reviewed repo, one single-pane job tab per run, model pinned to Opus 5).
// The session runs the globally-installed `jdiff-review` / `jdiff-ask` /
// `jdiff-tour` / `jdiff-chains` / `jdiff-hunt` skills, which POST back to
// this app's HTTP API (/api/review-artifact, /api/ask-result,
// /api/review-complete).
//
// The adapter itself lives in @jsuite/herdr (shared with jTicket and jMap).
// Re-exported here so Nitro auto-imports pick the names up. Unlike jTicket's
// --no-focus rule, jDiff dispatch deliberately focuses the new tab and brings
// the herdr window forward — "run all tools" is an explicit hand-off to a
// visible session, not background work. Fan-out sessions (chain walkers,
// hunt issue walkers) are the exception: they never focus (N of them would
// fight over the window).

export {
  HerdrError,
  herdrJson,
  herdrState,
  invalidateHerdrState,
  ensureHerdrWorkspace,
  createJobTab,
  acquirePackedPane,
  focusHerdrWindow,
  startClaudeIn,
} from '@jsuite/herdr'

/** Every review session runs on Opus 5, per suite policy. */
export const REVIEW_MODEL = 'claude-opus-5'

export const REVIEW_TOOLS = ['rating', 'risk', 'tour', 'questions', 'findings', 'chains', 'hunt'] as const
export type ReviewTool = (typeof REVIEW_TOOLS)[number]

// A target can have several kinds of session live at once: the five-artifact
// analyze run, an on-demand detail tour, a chains scoping session with one
// walker per chain, and a hunt scoping session with one walker per
// high-severity issue. Each is its own dispatch, keyed by job id.
export type ReviewJob =
  | 'analyze' | 'detail'
  | 'chains-scope' | `chain:${string}`
  | 'hunt-scope' | `issue:${string}`

/** Which artifacts a job's session is expected to POST before it is done. */
export function pendingToolsFor(job: ReviewJob): ReviewTool[] {
  if (job === 'analyze') return ['rating', 'risk', 'tour', 'questions', 'findings']
  if (job === 'chains-scope') return ['chains']
  if (job === 'hunt-scope') return ['hunt']
  return ['tour']
}

// One live dispatch per (repo, target, job). This registry only *tracks*
// work — the claude process belongs to herdr and outlives jDiff restarts;
// losing an entry loses the "running" badge, never the run. Artifacts still
// land via the POST endpoints whether or not the dispatch is remembered.
export interface ReviewDispatch {
  repo: string
  // The target's storeKey: a bare PR number, or "branch/<name>".
  number: string
  job: ReviewJob
  startedAt: number
  agent: string
  workspaceId: string
  tabId: string
  // Tools the session has not POSTed yet; empty ⇒ the dispatch is done.
  pending: Set<ReviewTool>
}

const dispatches = new Map<string, ReviewDispatch>()

// A session that died (closed pane, interrupted claude, wedged prompt) never
// posts anything — without a ceiling its dispatch would spin forever. Past
// this age the entry is dropped and the reason saved, so the UI shows why.
const STALE_MS = 60 * 60 * 1000

const keyOf = (repo: string, number: string, job: ReviewJob) => `${repo} ${number} ${job}`

function sweep(): void {
  const now = Date.now()
  for (const [key, d] of dispatches) {
    if (now - d.startedAt < STALE_MS) continue
    dispatches.delete(key)
    appendFailures(d.repo, d.number, [{
      jobKind: d.job,
      message: `the herdr session (agent ${d.agent}) never reported back — it may have been closed or interrupted`,
      at: new Date().toISOString(),
    }])
  }
}

export function registerReviewDispatch(d: Omit<ReviewDispatch, 'pending' | 'job'> & { job?: ReviewJob }): ReviewDispatch {
  const job = d.job ?? 'analyze'
  const entry: ReviewDispatch = { ...d, job, pending: new Set(pendingToolsFor(job)) }
  dispatches.set(keyOf(d.repo, d.number, job), entry)
  // This run supersedes whatever the last one of its kind failed with. A new
  // scope run also supersedes the walkers it is about to replace.
  clearFailures(d.repo, d.number, (kind) =>
    kind === job
    || (job === 'chains-scope' && kind.startsWith('chain:'))
    || (job === 'hunt-scope' && kind.startsWith('issue:')))
  return entry
}

export function getReviewDispatch(repo: string, number: string, job: ReviewJob = 'analyze'): ReviewDispatch | null {
  sweep()
  return dispatches.get(keyOf(repo, number, job)) ?? null
}

/** The session posted one artifact; the dispatch completes when none are left. */
export function markReviewToolPosted(repo: string, number: string, job: ReviewJob, tool: ReviewTool): void {
  const d = dispatches.get(keyOf(repo, number, job))
  if (!d) return
  d.pending.delete(tool)
  if (!d.pending.size) dispatches.delete(keyOf(repo, number, job))
}

export function clearReviewDispatch(repo: string, number: string, job: ReviewJob = 'analyze'): ReviewDispatch | null {
  const d = dispatches.get(keyOf(repo, number, job)) ?? null
  dispatches.delete(keyOf(repo, number, job))
  return d
}

/** Every live dispatch for one target, analyze first. */
export function targetDispatches(repo: string, number: string): ReviewDispatch[] {
  sweep()
  return [...dispatches.values()]
    .filter((d) => d.repo === repo && d.number === number)
    .sort((a, b) => (a.job === 'analyze' ? -1 : b.job === 'analyze' ? 1 : a.startedAt - b.startedAt))
}

export function allReviewDispatches(repo: string): ReviewDispatch[] {
  sweep()
  return [...dispatches.values()].filter((d) => d.repo === repo)
}
