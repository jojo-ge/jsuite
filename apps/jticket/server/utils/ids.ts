// Entity ids: UUIDv7, and the bridge from the ids minted before them.
//
// Every entity has an opaque `id` (what references store) and a human `key`
// (TICK-979). Ids are globally unique UUIDv7s so stores from different
// machines can one day meet without clashing; v7 because its leading 48 bits
// are the creation time in ms, so ids still sort in the order things were made.
//
// Before UUIDs, newId minted `${prefix}_${random}${time}` (tick_15ii7qe9mwbkpoa0).
// The one-off migration (idMigration.ts) rewrote those across .data and saved
// old → new in ID_MIGRATION_FILE; currentId/findByRef read that map so a
// legacy id still in someone's URL, browser tab or agent prompt keeps working.
//
// This module must not import the store (store.ts imports it for newId).
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { appDataFile } from '@jsuite/data'

/** A fresh UUIDv7 (RFC 9562) for the given unix ms — now by default. No dependency: 6 time bytes + random. */
export function uuidv7(ms: number = Date.now()): string {
  const b = randomBytes(16)
  const t = Math.min(Math.max(0, Math.floor(ms)), 2 ** 48 - 1)
  for (let i = 0; i < 6; i++) b[i] = Math.floor(t / 2 ** (8 * (5 - i))) % 256
  b[6] = (b[6]! & 0x0f) | 0x70 // version 7
  b[8] = (b[8]! & 0x3f) | 0x80 // variant 10
  const h = b.toString('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export function isUuidV7(v: unknown): v is string {
  return typeof v === 'string' && UUID_V7.test(v)
}

/** The unix ms a UUIDv7 was minted for. */
export function uuidv7Time(id: string): number {
  return parseInt(id.replace(/-/g, '').slice(0, 12), 16)
}

// The shape newId minted before UUIDs. Keys (TICK-9) and UUIDs never match it
// (uppercase / dashes), so a lookup only touches the map for a real legacy id.
const LEGACY_ID = /^[a-z]+_[0-9a-z]+$/

export function isLegacyId(v: unknown): v is string {
  return typeof v === 'string' && LEGACY_ID.test(v)
}

// ── Legacy lookup ───────────────────────────────────────────────────────────

/** Where the migration saved old → new (and where currentId reads it). */
export const ID_MIGRATION_FILE = appDataFile('jticket', 'id-migration.json')

export interface IdMigrationRecord {
  version: 1
  /** One entry per run that changed something. */
  runs: Array<{ at: string; backupDir: string; added: number }>
  map: Record<string, string>
}

let cached: { file: string; mtimeMs: number; map: Map<string, string> } | null = null

/** old id → new id, as the migration saved it ({} before it has run). Re-read only when the file changes. */
export function legacyIdMap(file: string = ID_MIGRATION_FILE): ReadonlyMap<string, string> {
  if (!existsSync(file)) return new Map()
  const mtimeMs = statSync(file).mtimeMs
  if (cached && cached.file === file && cached.mtimeMs === mtimeMs) return cached.map
  let map = new Map<string, string>()
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<IdMigrationRecord>
    map = new Map(Object.entries(parsed.map ?? {}).filter((e): e is [string, string] => typeof e[1] === 'string'))
  } catch {
    // A torn or hand-broken file: no legacy lookups rather than a 500 on every request.
  }
  cached = { file, mtimeMs, map }
  return map
}

/** The id a ref names today: a legacy id becomes its migrated UUID; anything else (a key, a UUID) is returned as is. */
export function currentId<T extends string | null | undefined>(ref: T): T | string {
  if (!isLegacyId(ref)) return ref
  return legacyIdMap().get(ref) ?? ref
}

/**
 * The entity a ref names — its id, its key, or an id from before the UUID
 * migration. Every "accepts an id or a key" lookup goes through here.
 */
export function findByRef<T extends { id: string; key?: string }>(list: readonly T[], ref: unknown): T | undefined {
  if (typeof ref !== 'string' || !ref) return undefined
  const id = currentId(ref)
  return list.find((e) => e.id === id || e.key === ref)
}
