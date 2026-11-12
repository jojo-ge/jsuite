import { REVIEW_OUTPUT_TAG } from '../../app/utils/documentLibrary'
import type { Review } from '../../app/utils/reviewTypes'
import { pendingReportKeys, reviewSweepDue, settleReviewers } from '../utils/reviewWatch'

// The review watcher: the review engine's only moving part (jReview's, run
// inside jTicket since TICK-942). Every few seconds it looks at each review
// still in `reviewing` and checks the shared document pool for each
// reviewer's pre-assigned document — a document landing IS that reviewer
// finishing. Once every reviewer is settled (done, or skipped by the human)
// and at least one report is in, it flips the review to `triaging` and
// dispatches the triage session. A consensus review (jTicket's auto loop)
// waits for EVERY reviewer's report and dispatches the consensus session
// instead — it files agreed findings into jTicket and skips triage. The
// decisions are pure, in server/utils/reviewWatch.ts.
//
// Once a review is triaged (or ticketed, for a consensus review) the watcher
// closes its herdr panes (closeReviewPanes) and, once they are closed, removes
// the worktree the engine cut for the review (removeReviewWorktree) — every
// session's cwd was that checkout, so it goes only after the panes have. The
// session that POSTed is usually still finishing its last reply, so a busy
// pane is left for a later sweep; after REVIEW_CLOSE_WINDOW_MS the watcher
// stops trying and leaves whatever is still busy to the human (a skipped
// reviewer stuck on a prompt, say) — and the checkout with it, until the
// review is deleted. This is the ONE sweep of review tabs: the auto loop's
// cleanup (panesToClean) leaves them alone.
//
// Server-side on purpose: triage fires whether or not a browser is open. It is
// one of jTicket's background engines, so a sandbox runs it only with
// --engines.

const TICK_MS = 4_000

export default defineNitroPlugin((nitroApp) => {
  if (!enginesEnabled()) return console.log('[jticket] review watcher off (sandbox / JTICKET_ENGINES=off)')
  let running = false
  const lastCloseTry = new Map<string, number>()

  async function tick() {
    if (running) return
    running = true
    try {
      for (const review of await listReviews()) {
        if (review.status === 'reviewing') await watchReview(review)
        else if (reviewSweepDue(review, Date.now(), lastCloseTry.get(review.key))) await closePanes(review)
      }
    } catch (err) {
      console.error('[jticket] review watcher tick failed:', err)
    } finally {
      running = false
    }
  }

  async function watchReview(seen: Review) {
    // Look the reports up outside the serialised update; the update re-reads
    // the review and settles only reviewers still waiting.
    const landed = new Set<string>()
    for (const docKey of pendingReportKeys(seen)) {
      const report = await readDoc(docKey)
      if (!report) continue
      landed.add(docKey)
      // File it as a review output whatever the reviewer's skill tagged it, so
      // it stays out of the document library until asked for.
      if (!report.tags?.includes(REVIEW_OUTPUT_TAG)) await setDocTags(docKey, [REVIEW_OUTPUT_TAG])
    }
    let fireTriage = false
    await updateReview(seen.key, (review) => {
      const step = settleReviewers(review, landed, new Date().toISOString())
      fireTriage = step.fireTriage
      return step.changed
    })
    if (fireTriage) await dispatchTriage(seen.key)
  }

  async function closePanes(review: Review) {
    lastCloseTry.set(review.key, Date.now())
    if (!review.panesClosedAt) {
      try {
        if (!(await closeReviewPanes(review.key))) return
      } catch {
        return // herdr down — next sweep
      }
      await updateReview(review.key, (r) => {
        r.panesClosedAt = new Date().toISOString()
      }).catch(() => {}) // deleted meanwhile
    }
    // The panes are gone, so nothing runs in the checkout any more: remove it.
    // A worktree left behind for every review is how a codebase's worktree
    // directory fills up with detached jreview-* checkouts.
    if (review.worktree && !review.worktreeRemovedAt) {
      await removeReviewWorktree(review.repoPath, review.workdir)
      await updateReview(review.key, (r) => {
        r.worktreeRemovedAt = new Date().toISOString()
      }).catch(() => {})
    }
    lastCloseTry.delete(review.key)
  }

  const timer = setInterval(tick, TICK_MS)
  timer.unref?.()
  nitroApp.hooks.hook('close', () => clearInterval(timer))
})
