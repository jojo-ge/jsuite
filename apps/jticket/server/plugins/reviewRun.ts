// Drive PR review projects' review plans: every few seconds, one
// reviewRunStep for each project whose run is going — checks, gate, the
// agreement review, done. Separate from the auto loop's plugin on purpose: a
// review plan is its own run setup and never goes through auto mode.

const TICK_MS = 5_000

export default defineNitroPlugin((nitroApp) => {
  if (!enginesEnabled()) return console.log('[jticket] review runner off (sandbox / JTICKET_ENGINES=off)')
  const timer = setInterval(() => {
    tickReviewRuns().catch((err) => console.error('[jticket] review run tick failed:', err))
  }, TICK_MS)
  timer.unref?.()
  nitroApp.hooks.hook('close', () => clearInterval(timer))
})
