// Keep tickets in step with their Jira issues (server/utils/jiraSync.ts).
// No .data/jticket/jira.json = nothing configured, so the timer never starts.
export default defineNitroPlugin(() => {
  if (!jiraConfig()) return
  let running = false
  const timer = setInterval(() => {
    if (running) return
    running = true
    syncJira()
      .then(({ pulled, pushed, errors }) => {
        for (const line of [...pulled, ...pushed]) console.info(`[jira-sync] ${line}`)
        for (const line of errors) console.warn(`[jira-sync] ${line}`)
      })
      .catch((error) => console.warn(`[jira-sync] ${(error as Error).message}`))
      .finally(() => (running = false))
  }, 60_000)
  timer.unref?.()
})
