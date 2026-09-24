import { reviewerSettled } from '../../app/utils/reviewTypes'

// The review watcher: jReview's only moving part. Every few seconds it looks
// at each review still in `reviewing` and checks the shared document pool for
// each reviewer's pre-assigned jExplain document — a document landing IS that
// reviewer finishing. Once every reviewer is settled (done, or skipped by the
// human) and at least one report is in, it flips the review to `triaging` and
// dispatches the triage session.
//
// Server-side on purpose: triage fires whether or not a browser is open.

const TICK_MS = 4_000

export default defineNitroPlugin((nitroApp) => {
  let running = false

  async function tick() {
    if (running) return
    running = true
    try {
      for (const review of await listReviews()) {
        if (review.status !== 'reviewing') continue
        await watchReview(review.key)
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
      const settled = review.reviewers.every(reviewerSettled)
      const anyReport = review.reviewers.some((r) => r.status === 'done')
      if (settled && anyReport) {
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

  const timer = setInterval(tick, TICK_MS)
  nitroApp.hooks.hook('close', () => clearInterval(timer))
})
