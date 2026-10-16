// Run one Jira sync pass now, rather than waiting for the minute timer.
export default defineEventHandler(() => syncJira())
