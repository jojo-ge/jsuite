// Send back — the Review tab's button on a review project that sits after a
// build in a graph. Body: { ticketKeys: string[], to?: 'PROJ-n' }. Each picked
// finding ticket becomes a normal, dispatchable AFK bug ticket on the build
// (its title, description, file and line, and a link back), and the finding
// ticket records the ticket it became; one already sent files nothing new.
// `to` picks the build when several lead into the review. 409 outside a
// graph. Starts nothing — the human runs the fixes, then reruns the review.
// Returns { target, sent: [{key, ticketKey}], already, refused }.
export default defineEventHandler(async (event) => {
  const body = (await readBody<{ ticketKeys?: unknown; to?: unknown }>(event)) ?? {}
  const store = loadStore()
  const result = sendBackFindings(store, getRouterParam(event, 'id'), body, now(), JTICKET_PUBLIC)
  if (result.sent.length) saveStore(store)
  return result
})
