// The frozen session digests (harnessCapture.ts), oldest first — each
// ledgered session's metrics and friction as its transcript last stood.
// Query: ?project= (key or id), ?repo= (a codebase path or slug), ?role=,
// ?harness= (a harness version), ?from= / ?to= (ISO dates, on the dispatch
// time). Rows are summaries; ?full=1 returns the whole digests.
export default defineEventHandler((event) => {
  const q = getQuery(event)
  const store = loadStore()
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  const project = str(q.project) ? findProjectRef(store, q.project) : undefined
  if (str(q.project) && !project) throw createError({ statusCode: 404, statusMessage: 'project not found' })
  const repo = resolveRepoParam(store, q.repo)
  const from = str(q.from) ? new Date(str(q.from)).toISOString() : ''
  const to = str(q.to) ? new Date(str(q.to)).toISOString() : ''
  const digests = listSessionDigests().filter(
    (d) =>
      (!project || d.record.projectId === project.id) &&
      (!repo || d.record.repo === repo) &&
      (!str(q.role) || d.record.role === str(q.role)) &&
      (!str(q.harness) || d.record.harness === str(q.harness)) &&
      (!from || d.record.dispatchedAt >= from) &&
      (!to || d.record.dispatchedAt <= to),
  )
  if (q.full) return { sessions: digests }
  return {
    sessions: digests.map((d) => {
      const f = digestFriction(d)
      return {
        id: d.id,
        role: d.record.role,
        ticketKey: d.record.ticketKey,
        projectKey: d.record.projectKey,
        repo: d.record.repo,
        model: d.record.model,
        effort: d.record.effort,
        harness: d.record.harness,
        setup: d.record.setup,
        dispatchedAt: d.record.dispatchedAt,
        frozenAt: d.frozenAt,
        durationMs: d.report.session.durationMs,
        usd: d.report.totalCost.usd,
        subagents: d.subagents.length,
        toolCalls: f.toolCalls,
        toolErrors: f.toolErrors,
        byClass: f.byClass,
        apiErrors: f.apiErrors.length,
        humanTurns: f.humanTurns,
        nudges: f.nudges,
        readsBeforeFirstEdit: f.reads.beforeFirstEdit,
        compactions: f.compactions,
      }
    }),
  }
})
