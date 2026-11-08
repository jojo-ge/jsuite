// Global analytics: every project's tickets, orchestrations and jobs rolled
// up — spend and close-time trend by week, the project league table, model
// and mode comparisons, the verification profile and the machine-wide
// concurrency of heavy runs. Nothing is stored: rows come from the session
// ledger and the (cached) claude transcripts on every call.
//
// Query: ?repo= (a codebase path or slug), ?from= / ?to= (ISO dates, on the
// session's dispatch time), ?rows=1 to include the per-ticket rows.
export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const store = loadStore()
  const repo = resolveRepoParam(store, q.repo)
  const from = typeof q.from === 'string' && q.from ? new Date(q.from).toISOString() : undefined
  const to = typeof q.to === 'string' && q.to ? new Date(q.to).toISOString() : undefined
  if ((q.from && !from) || (q.to && !to)) throw createError({ statusCode: 400, statusMessage: 'from/to must be dates' })
  const data = await buildAnalytics(store, { repo: repo || undefined, from, to })
  const result = rollup(data)
  return {
    generatedAt: data.generatedAt,
    filter: { repo: repo || null, from: from ?? null, to: to ?? null },
    ledger: data.ledger,
    ...result,
    tickets: q.rows ? data.tickets : undefined,
    orchestrations: data.orchestrations,
    jobs: data.jobs,
  }
})
