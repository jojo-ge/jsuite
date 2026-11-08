// Backfill the session ledger from every codebase's transcripts — see
// analyticsBackfill.ts. Idempotent; safe to re-run. Body: {} (everything) or
// { project: "PROJ-n" } for one project's codebase.
export default defineEventHandler(async (event) => {
  const body: { project?: string } = (await readBody<{ project?: string }>(event).catch(() => ({}))) ?? {}
  const store = loadStore()
  let projectIds: Set<string> | undefined
  if (body.project) {
    const p = findProjectRef(store, body.project)
    if (!p) throw createError({ statusCode: 404, statusMessage: 'project not found' })
    projectIds = new Set([p.id])
  }
  return backfillSessions(store, { projectIds })
})
