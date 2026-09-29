import { readyForTriage, type Review } from '../../app/utils/reviewTypes'

// The review watcher: jReview's only moving part. Every few seconds it looks
// at each review still in `reviewing` and checks the shared document pool for
// each reviewer's pre-assigned jExplain document — a document landing IS that
// reviewer finishing. Once every reviewer is settled (done, or skipped by the
// human) and at least one report is in, it flips the review to `triaging` and
// dispatches the triage session. A consensus review (jTicket's auto loop)
// waits for EVERY reviewer's report and dispatches the consensus session
// instead — it files agreed findings into jTicket and skips triage.
//
// Once a review is triaged (or ticketed, for a consensus review) the watcher
// closes its herdr panes (closeReviewPanes). The session that POSTed is
// usually still finishing its last reply, so a busy pane is left for a later
// sweep; after CLOSE_WINDOW_MS the watcher stops trying and leaves whatever is
// still busy to the human (a skipped reviewer stuck on a prompt, say).
//
// Server-side on purpose: triage fires whether or not a browser is open.

const TICK_MS = 4_000
/** How often one finished review's panes are re-checked while a session in them is busy. */
const CLOSE_RETRY_MS = 12_000
/** How long after triage lands the watcher keeps trying to close the panes. */
const CLOSE_WINDOW_MS = 10 * 60_000

export default defineNitroPlugin((nitroApp) => {
  let running = false
  const lastCloseTry = new Map<string, number>()

  async function tick() {
    if (running) return
    running = true
    try {
      for (const review of await listReviews()) {
        if (review.status === 'reviewing') await watchReview(review.key)
        else if (review.status === 'triaged' || review.status === 'ticketed') await closePanes(review)
      }
    } catch (err) {
      console.error('[jreview] watcher tick failed:', err)
    } finally {
      running = false
    }
  }

  async function watchReview(key: string) {
    let fireTriage = false
    await updateReview(key, async (review) => {
      if (review.status !== 'reviewing') return false
      let changed = false
      for (const r of review.reviewers) {
        if (r.status === 'done' || r.status === 'skipped') continue
        // Any state — a reviewer whose dispatch "failed" may still have run.
        if (await readDoc(r.docKey)) {
          r.status = 'done'
          r.error = undefined
          r.doneAt = new Date().toISOString()
          changed = true
        }
      }
      if (readyForTriage(review)) {
        // Claimed here, inside the serialised update, so a second tick can
        // never dispatch a second triager.
        review.status = 'triaging'
        fireTriage = true
        changed = true
      }
      return changed
    })
    if (fireTriage) await dispatchTriage(key)
  }

  async function closePanes(review: Review) {
    if (review.panesClosedAt) return
    // Reviews finished before this sweep existed (or given up on) are left alone.
    const doneAt = Date.parse(review.triage.doneAt ?? '')
    if (!doneAt || Date.now() - doneAt > CLOSE_WINDOW_MS) return
    if (Date.now() - (lastCloseTry.get(review.key) ?? 0) < CLOSE_RETRY_MS) return
    lastCloseTry.set(review.key, Date.now())
    try {
      if (!(await closeReviewPanes(review.key))) return
    } catch {
      return // herdr down — next sweep
    }
    lastCloseTry.delete(review.key)
    await updateReview(review.key, (r) => {
      r.panesClosedAt = new Date().toISOString()
    }).catch(() => {}) // deleted meanwhile
  }

  const timer = setInterval(tick, TICK_MS)
  nitroApp.hooks.hook('close', () => clearInterval(timer))
})
