// The review watcher's decisions — pure, no I/O (tests/reviewWatch.test.ts).
// server/plugins/reviewWatcher.ts reads the store and the document pool,
// asks these, and does what they say.
import { readyForTriage, type Review } from '../../app/utils/reviewTypes'

/** How often one finished review's panes are re-checked while a session in them is busy. */
export const REVIEW_CLOSE_RETRY_MS = 12_000
/**
 * How long after the hand-back lands the watcher keeps trying to close the
 * panes. Two hours, not jReview's ten minutes: this sweep is now the only one
 * (the auto loop's cleanup was the long-lived backstop), so a session still
 * finishing well after its POST is still swept once it goes idle.
 */
export const REVIEW_CLOSE_WINDOW_MS = 2 * 60 * 60_000

/**
 * A `reviewing` review, given which documents are in the pool: every
 * unsettled reviewer whose report has landed is marked done (whatever its
 * state — a reviewer whose dispatch "failed" may still have run), and once the
 * review is ready the review is claimed for triage (`triaging`). Mutates
 * `review`; `changed` says whether to write it, `fireTriage` whether to
 * dispatch the triage (or consensus) session — true at most once per review,
 * because the claim happens here, inside the caller's serialised update.
 */
export function settleReviewers(review: Review, landed: ReadonlySet<string>, at: string): { changed: boolean; fireTriage: boolean } {
  if (review.status !== 'reviewing') return { changed: false, fireTriage: false }
  let changed = false
  for (const r of review.reviewers) {
    if (r.status === 'done' || r.status === 'skipped') continue
    if (landed.has(r.docKey)) {
      r.status = 'done'
      r.error = undefined
      r.doneAt = at
      changed = true
    }
  }
  if (!readyForTriage(review)) return { changed, fireTriage: false }
  review.status = 'triaging'
  return { changed: true, fireTriage: true }
}

/** The reviewers still waiting on a report — the documents worth looking up. */
export function pendingReportKeys(review: Pick<Review, 'status' | 'reviewers'>): string[] {
  if (review.status !== 'reviewing') return []
  return review.reviewers.filter((r) => r.status !== 'done' && r.status !== 'skipped').map((r) => r.docKey)
}

/**
 * Whether to sweep a finished review now: close its herdr panes and then
 * remove its worktree. Only a triaged/ticketed review with something left to
 * do, inside REVIEW_CLOSE_WINDOW_MS of its hand-back (reviews finished before
 * the sweep existed, or given up on, are left alone), and no sooner than
 * REVIEW_CLOSE_RETRY_MS after the last try.
 */
export function reviewSweepDue(
  review: Pick<Review, 'status' | 'panesClosedAt' | 'worktree' | 'worktreeRemovedAt' | 'triage'>,
  now: number,
  lastTry = 0,
): boolean {
  if (review.status !== 'triaged' && review.status !== 'ticketed') return false
  const worktreePending = review.worktree && !review.worktreeRemovedAt
  if (review.panesClosedAt && !worktreePending) return false
  const doneAt = Date.parse(review.triage.doneAt ?? '')
  if (!doneAt || now - doneAt > REVIEW_CLOSE_WINDOW_MS) return false
  return now - lastTry >= REVIEW_CLOSE_RETRY_MS
}
