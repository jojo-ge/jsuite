// The one-off move of every pre-UUID id in .data to a UUIDv7 (idMigration.ts).
// Run here, inside the server, so nothing reads or writes the store halfway
// and the in-memory state keyed by project id is reset right after.
//
// Body: { dryRun?: boolean } — a dry run reports what would change and
// touches nothing. A real run copies the whole .data to
// `.data.backup-ids-<stamp>` beside it first, saves old → new to
// .data/jticket/id-migration.json, then rewrites each changed file
// atomically. A second run answers `noop: true`.
//
// 409 while an auto loop or a run-plan build is going: their sessions hold
// ids in their prompts (legacy lookups would cover them, but a run is the
// wrong moment to rewrite the store under it).
import { dataRoot } from '@jsuite/data'
import { migrateIdsInDir } from '../../utils/idMigration'
import { resetJournalState } from '../../utils/runJournal'

export default defineEventHandler(async (event) => {
  const body = (await readBody<{ dryRun?: unknown }>(event).catch(() => null)) ?? {}
  const dryRun = body.dryRun === true
  const busy = loadStore().projects.filter((p) => p.auto?.enabled || p.runPlanBuild).map((p) => p.key)
  if (busy.length && !dryRun) {
    throw createError({ statusCode: 409, statusMessage: `stop these first: ${busy.join(', ')}` })
  }
  const result = migrateIdsInDir(dataRoot(), { dryRun })
  // The run journal remembers each project's last-saved loop state by id; old
  // ids there would read every project as new on the next save.
  if (!dryRun && !result.noop) resetJournalState()
  return result
})
