// One run's snapshot (harnessCapture.ts): its journal events, pauses, tickets,
// reviews with each finding attributed to the ticket that introduced it, and
// totals over its sessions. A frozen snapshot is served as stored; a run still
// going, or not yet snapshotted, is built on the spot and not stored
// (`live: true`).
import { journalRuns } from '../../../../app/utils/runJournal'

export default defineEventHandler(async (event) => {
  const id = decodeURIComponent(getRouterParam(event, 'id') ?? '')
  const frozen = readRunSnapshot(id)
  if (frozen) return { live: false, ...frozen }
  const run = journalRuns(readJournal()).find((r) => r.runId === id)
  if (!run) throw createError({ statusCode: 404, statusMessage: 'run not found' })
  return { live: true, ...(await buildRunSnapshot(loadStore(), run)) }
})
