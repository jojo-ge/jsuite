// Drive auto mode (the jButton): every few seconds, one planStep for each
// project whose loop is on — implement → merge → review → fix → merge, then
// the next loop. Server-side on purpose, like jReview's review watcher: the
// loop runs whether or not a browser is open. All state is on the project in
// jticket.json, so a restart just picks the loop back up.

const TICK_MS = 5_000

export default defineNitroPlugin((nitroApp) => {
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
  nitroApp.hooks.hook('close', () => clearInterval(timer))
})
