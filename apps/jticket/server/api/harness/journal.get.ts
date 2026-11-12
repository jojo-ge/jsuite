// The run journal: every event of every auto-mode run, oldest first
// (runJournal.ts). Query: ?project= (key or id), ?run= (a run id),
// ?kind= (comma-separated event kinds), ?from= / ?to= (ISO dates).
export default defineEventHandler((event) => {
  const q = getQuery(event)
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  const project = str(q.project) ? findProjectRef(loadStore(), q.project) : undefined
  if (str(q.project) && !project) throw createError({ statusCode: 404, statusMessage: 'project not found' })
  const kinds = new Set(str(q.kind).split(',').map((k) => k.trim()).filter(Boolean))
  const date = (v: unknown) => {
    if (!str(v)) return ''
    const t = Date.parse(str(v))
    if (!Number.isFinite(t)) throw createError({ statusCode: 400, statusMessage: 'from/to must be dates' })
    return new Date(t).toISOString()
  }
  const from = date(q.from)
  const to = date(q.to)
  const events = readJournal().filter((l) => (!project || l.projectId === project.id) && (!str(q.run) || l.runId === str(q.run)) && (!kinds.size || kinds.has(l.kind)) && (!from || l.at >= from) && (!to || l.at <= to))
  return { events }
})
