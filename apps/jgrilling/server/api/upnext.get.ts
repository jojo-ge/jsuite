/**
 * The HITL grilling frontier from jTicket, grouped by project — what jGrilling
 * shows as "Up next". `available: false` means jTicket isn't reachable, which
 * the UI treats as "no strip", not an error.
 */
export default defineEventHandler(async () => {
  try {
    return { available: true, groups: await fetchGrillingFrontier() }
  } catch {
    return { available: false, groups: [] }
  }
})
