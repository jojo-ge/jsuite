// One-time data migration run by `./jsuite setup`: rewrites tickets still in
// the pre-types shape ('AFK' | 'HITL' as the type, wayfinder:<sub-type>
// labels) into a main type + afk/hitl/prototype tags. Idempotent — a second run
// finds nothing to change. The jTicket loader applies the same fold on read, so
// this only makes the file on disk match what the app already serves.
//
//   tsx scripts/migrate-ticket-types.ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { appDataFile } from '@jsuite/data'
import { defaultTicketType, isLegacyTicket, normalizeTicketKind } from '../server/utils/ticketTypes'

interface RawTicket {
  projectId?: string | null
  type?: unknown
  labels?: string[]
}
interface RawStore {
  projects?: Array<{ id: string; mode?: string }>
  tickets?: RawTicket[]
}

const file = appDataFile('jticket', 'jticket.json')
if (!existsSync(file)) {
  console.log('no jticket data yet — nothing to migrate')
  process.exit(0)
}

const store = JSON.parse(readFileSync(file, 'utf8')) as RawStore
const modeOf = new Map((store.projects ?? []).map((p) => [p.id, p.mode]))
let migrated = 0
for (const t of store.tickets ?? []) {
  if (!isLegacyTicket(t)) continue
  const labels = t.labels ?? []
  Object.assign(t, normalizeTicketKind({ type: t.type, labels }, defaultTicketType(labels, modeOf.get(t.projectId ?? ''))))
  migrated++
}

if (migrated) {
  writeFileSync(file, JSON.stringify(store, null, 2) + '\n', 'utf8')
  console.log(`migrated ${migrated} ticket${migrated === 1 ? '' : 's'} to ticket types`)
} else {
  console.log('tickets already on ticket types')
}
