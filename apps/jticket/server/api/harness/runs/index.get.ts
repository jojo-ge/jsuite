// Every auto-mode run the journal knows, newest first: when it ran, how it
// ended, how many of each event, and whether its snapshot has been frozen
// (harnessCapture.ts). Query: ?project= (key or id), ?repo= (a codebase path
// or slug), ?from= / ?to= (ISO dates, on the run's start).
import { eventCounts, journalRuns } from '../../../../app/utils/runJournal'

export default defineEventHandler((event) => {
  const q = getQuery(event)
  const store = loadStore()
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  const project = str(q.project) ? findProjectRef(store, q.project) : undefined
  if (str(q.project) && !project) throw createError({ statusCode: 404, statusMessage: 'project not found' })
  const repo = resolveRepoParam(store, q.repo)
  const repoOf = new Map(store.projects.map((p) => [p.id, projectRepoPath(p)]))
  const from = str(q.from) ? new Date(str(q.from)).toISOString() : ''
  const to = str(q.to) ? new Date(str(q.to)).toISOString() : ''
  const runs = journalRuns(readJournal())
    .filter((r) => (!project || r.projectId === project.id) && (!repo || repoOf.get(r.projectId) === repo) && (!from || r.startedAt >= from) && (!to || r.startedAt <= to))
    .reverse()
    .map((r) => {
      const snapshot = readRunSnapshot(r.runId)
      return {
        runId: r.runId,
        projectKey: r.projectKey,
        repo: repoOf.get(r.projectId) ?? r.repo,
        kind: r.kind,
        startedAt: r.startedAt,
        endedAt: r.endedAt,
        endReason: r.endReason,
        counts: eventCounts(r.events),
        snapshot: snapshot ? { frozenAt: snapshot.frozenAt, pending: snapshot.pending.length, harness: snapshot.harness, totals: snapshot.totals } : null,
      }
    })
  return { runs }
})
