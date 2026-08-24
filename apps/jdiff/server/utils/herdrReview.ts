// Driving Herdr (the terminal workspace manager) from jDiff.
//
// jDiff runs NO claude of its own: review guidance is produced by an
// interactive claude session dispatched into herdr (one workspace per
// reviewed repo, one single-pane job tab per run, model pinned to Opus 5).
// The session runs the globally-installed `jdiff-review` / `jdiff-ask`
// skills, which POST their artifacts back to this app's HTTP API
// (/api/review-artifact, /api/ask-result, /api/review-complete).
//
// The adapter itself lives in @jsuite/herdr (shared with jTicket and jMap).
// Re-exported here so Nitro auto-imports pick the names up. Unlike jTicket's
// --no-focus rule, jDiff dispatch deliberately focuses the new tab and brings
// the herdr window forward — "run all tools" is an explicit hand-off to a
// visible session, not background work.

export {
  HerdrError,
  herdrJson,
  herdrState,
  invalidateHerdrState,
  ensureHerdrWorkspace,
  createJobTab,
  focusHerdrWindow,
  startClaudeIn,
} from '@jsuite/herdr'

/** Every review session runs on Opus 5, per suite policy. */
export const REVIEW_MODEL = 'claude-opus-5'

export const REVIEW_TOOLS = ['rating', 'risk', 'tour', 'questions', 'findings'] as const
export type ReviewTool = (typeof REVIEW_TOOLS)[number]

// One live dispatch per (repo, target). This registry only *tracks* work —
// the claude process belongs to herdr and outlives jDiff restarts; losing an
// entry loses the "running" badge, never the run. Artifacts still land via
// the POST endpoints whether or not the dispatch is remembered.
export interface ReviewDispatch {
  repo: string
  // The target's storeKey: a bare PR number, or "branch/<name>".
  number: string
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

const keyOf = (repo: string, number: string) => `${repo} ${number}`

function sweep(): void {
  const now = Date.now()
  for (const [key, d] of dispatches) {
    if (now - d.startedAt < STALE_MS) continue
    dispatches.delete(key)
    saveFailures({
      repo: d.repo,
      number: d.number,
      failures: [{
        jobKind: 'analyze',
        message: `the herdr review session (agent ${d.agent}) never reported back — it may have been closed or interrupted`,
        at: new Date().toISOString(),
      }],
    })
  }
}

export function registerReviewDispatch(d: Omit<ReviewDispatch, 'pending'>): ReviewDispatch {
  const entry: ReviewDispatch = { ...d, pending: new Set(REVIEW_TOOLS) }
  dispatches.set(keyOf(d.repo, d.number), entry)
  // This run supersedes whatever the last one failed with.
  saveFailures({ repo: d.repo, number: d.number, failures: [] })
  return entry
}

export function getReviewDispatch(repo: string, number: string): ReviewDispatch | null {
  sweep()
  return dispatches.get(keyOf(repo, number)) ?? null
}

/** The session posted one artifact; the dispatch completes when none are left. */
export function markReviewToolPosted(repo: string, number: string, tool: ReviewTool): void {
  const d = dispatches.get(keyOf(repo, number))
  if (!d) return
  d.pending.delete(tool)
  if (!d.pending.size) dispatches.delete(keyOf(repo, number))
}

export function clearReviewDispatch(repo: string, number: string): ReviewDispatch | null {
  const d = dispatches.get(keyOf(repo, number)) ?? null
  dispatches.delete(keyOf(repo, number))
  return d
}

export function allReviewDispatches(repo: string): ReviewDispatch[] {
  sweep()
  return [...dispatches.values()].filter((d) => d.repo === repo)
}
