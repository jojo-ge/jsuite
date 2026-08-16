// The observers live here, not in request handlers: completion arrives over
// jTicket's SSE stream whether or not a browser is open, pane scans keep the
// needs-you flag honest, and the fleet drains queues unattended.
export default defineNitroPlugin((nitroApp) => {
  void reconcileRuns().then(() => fleetTick())

  const unsubscribe = trackerSubscribe(() => {
    void checkCompletions()
  })
  const scanTimer = setInterval(() => {
    void scanPanes()
  }, 5000)
  const fleetTimer = setInterval(() => {
    void fleetTick()
  }, 15000)

  nitroApp.hooks.hook('close', () => {
    unsubscribe()
    clearInterval(scanTimer)
    clearInterval(fleetTimer)
  })
})
