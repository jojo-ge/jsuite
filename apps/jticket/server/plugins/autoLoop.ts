// Drive auto mode (the jButton): every few seconds, one planStep for each
// project whose loop is on — implement → merge → review → fix → merge, then
// the next loop. Server-side on purpose, like jReview's review watcher: the
// loop runs whether or not a browser is open. All state is on the project in
// jticket.json, so a restart just picks the loop back up.

const TICK_MS = 5_000
const CAPTURE_MS = 10 * 60_000

export default defineNitroPlugin((nitroApp) => {
  // A sandbox runs over a copy of real projects — its engines stay off unless asked for.
  if (!enginesEnabled()) return console.log('[jticket] auto loop off (sandbox / JTICKET_ENGINES=off)')
  let running = false

  async function tick() {
    if (running) return
    running = true
    try {
      const ids = loadStore()
        .projects.filter((p) => p.auto?.enabled)
        .map((p) => p.id)
      // One project at a time — herdr dispatches must not overlap.
      for (const id of ids) await advanceAutoLoop(id)
    } catch (err) {
      console.error('[jticket] auto loop tick failed:', err)
    } finally {
      running = false
    }
  }

  const timer = setInterval(tick, TICK_MS)
  timer.unref?.()

  // Harness capture rides the same plugin: every few minutes, freeze the
  // sessions that have finished and snapshot the runs that have ended
  // (harnessCapture.ts) — before claude's transcript cleanup takes the evidence.
  async function capture() {
    try {
      const r = await captureHarness(loadStore())
      if (r.sessions.frozen || r.runs.snapshotted.length) console.log(`[jticket] harness capture: ${r.sessions.frozen} session(s) frozen, ${r.runs.snapshotted.length} run(s) snapshotted`)
    } catch (err) {
      console.error('[jticket] harness capture failed:', err)
    }
  }
  const captureTimer = setInterval(capture, CAPTURE_MS)
  captureTimer.unref?.()

  nitroApp.hooks.hook('close', () => {
    clearInterval(timer)
    clearInterval(captureTimer)
  })
})
