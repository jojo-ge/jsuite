// The one-off move from pre-UUID ids (tick_15ii7qe9mwbkpoa0) to UUIDv7s,
// across every JSON file under .data — the store and its old backups, the
// session ledger, harness capture, review records, tours, the document and
// chart pools. Keys (TICK-979) never change; only ids.
//
// Two halves:
//   planIdMigration / rewriteIdsInText — pure: decide old → new, rewrite one
//     file's text. Every string value and object key is searched, so ids
//     inside longer strings (URLs in descriptions, prompts) move too.
//   migrateIdsInDir — the runner over a data dir: backup beside it, atomic
//     writes, the map saved to jticket/id-migration.json (which currentId in
//     ids.ts reads, so a legacy id in a URL still resolves).
//
// Idempotent: the saved map is the starting point and migrated ids no longer
// look legacy, so a second run finds nothing and writes nothing.
import { cpSync, existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isLegacyId, uuidv7, type IdMigrationRecord } from './ids'

// The prefixes newId ever used (epic: the layer loadStore folds away, still in
// old backups). Only these are trusted outside an entity's own `id` field.
const LEGACY_PREFIXES = ['proj', 'tick', 'cmt', 'share', 'pr', 'doc', 'epic']

// A minted legacy id: prefix, `_`, ≤8 random base36 chars, then Date.now() in
// base36 — 8 chars for any date this century. The time tail is what tells a
// real id from prose like `pr_comments`.
const MINTED = new RegExp(`(?<![0-9A-Za-z])(?:${LEGACY_PREFIXES.join('|')})_[0-9a-z]{9,16}(?![0-9A-Za-z])`, 'g')
const PLAUSIBLE_MS = [Date.UTC(2020, 0, 1), Date.UTC(2040, 0, 1)] as const

/** The ms a legacy id was minted at (its base36 time tail), or null when it carries none. */
export function legacyIdTime(id: string): number | null {
  const tail = id.slice(id.indexOf('_') + 1).slice(-8)
  if (tail.length < 8) return null
  const ms = parseInt(tail, 36)
  return ms >= PLAUSIBLE_MS[0] && ms < PLAUSIBLE_MS[1] ? ms : null
}

function isoMs(v: unknown): number | null {
  if (typeof v !== 'string') return null
  const ms = Date.parse(v)
  return Number.isFinite(ms) ? ms : null
}

// A jTicket store file (the live one or a backup of it): its entities' `id`
// fields are ids by definition, whatever their shape — hand-made ones like
// proj_vibesync included.
function isStoreShaped(v: unknown): boolean {
  return !!v && typeof v === 'object' && !Array.isArray(v) && (Array.isArray((v as { projects?: unknown }).projects) || Array.isArray((v as { tickets?: unknown }).tickets))
}

export interface MigrationFile {
  path: string // relative to the data dir — reports only
  text: string
}

export interface IdMigrationPlan {
  /** Every legacy id → its UUIDv7: the existing map plus what this run adds. */
  map: Record<string, string>
  /** The legacy ids this run adds to the map. */
  added: string[]
}

function parseFile(f: MigrationFile): unknown[] {
  if (f.path.endsWith('.jsonl')) {
    return f.text.split('\n').filter((l) => l.trim()).flatMap((l) => {
      try { return [JSON.parse(l)] } catch { return [] }
    })
  }
  try { return [JSON.parse(f.text)] } catch { return [] }
}

/**
 * Decide old → new for every legacy id in these files. An entity's new id
 * takes its v7 time from the entity's createdAt (else the old id's own time
 * tail, else `at`), so ids still sort in creation order. Ids already in
 * `existing` keep their mapping — a second run, or a stray old id turning up
 * later, lands on the same UUID.
 */
export function planIdMigration(files: MigrationFile[], existing: Record<string, string> = {}, at: number = Date.now()): IdMigrationPlan {
  const found = new Map<string, number | null>() // legacy id → createdAt ms when known
  const note = (id: string, ms: number | null) => {
    if (existing[id]) return
    const was = found.get(id)
    if (was === undefined || (was === null && ms !== null)) found.set(id, ms)
  }
  const scanString = (s: string) => {
    for (const m of s.matchAll(MINTED)) if (legacyIdTime(m[0]) !== null) note(m[0], null)
  }
  const walk = (v: unknown, inStore: boolean) => {
    if (typeof v === 'string') return scanString(v)
    if (Array.isArray(v)) return v.forEach((x) => walk(x, inStore))
    if (!v || typeof v !== 'object') return
    const o = v as Record<string, unknown>
    if (inStore && isLegacyId(o.id)) note(o.id, isoMs(o.createdAt))
    for (const [k, x] of Object.entries(o)) {
      scanString(k)
      walk(x, inStore)
    }
  }
  for (const f of files) for (const doc of parseFile(f)) walk(doc, isStoreShaped(doc))

  const map = { ...existing }
  const added = [...found.keys()].sort()
  for (const id of added) map[id] = uuidv7(found.get(id) ?? legacyIdTime(id) ?? at)
  return { map, added }
}

/** A matcher for exactly the ids in the map, standing alone or inside a longer string. */
function idMatcher(map: Record<string, string>): RegExp | null {
  const prefixes = [...new Set(Object.keys(map).map((id) => id.slice(0, id.indexOf('_'))))].filter(Boolean)
  if (!prefixes.length) return null
  return new RegExp(`(?<![0-9A-Za-z])(?:${prefixes.join('|')})_[0-9a-z]+(?![0-9A-Za-z])`, 'g')
}

function rewriteValue(v: unknown, swap: (s: string) => string): unknown {
  if (typeof v === 'string') return swap(v)
  if (Array.isArray(v)) return v.map((x) => rewriteValue(x, swap))
  if (!v || typeof v !== 'object') return v
  const out: Record<string, unknown> = {}
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[swap(k)] = rewriteValue(x, swap)
  return out
}

/**
 * One file's text with every mapped id replaced, and how many replacements
 * that took — `text: null` when nothing changed (the file is left alone).
 * Changed files are re-serialised the way the app writes them (2-space
 * indent when the file had it, compact otherwise; trailing newline kept).
 * A .jsonl is done line by line; a line that won't parse (a torn append) is
 * rewritten as plain text.
 */
export function rewriteIdsInText(path: string, text: string, map: Record<string, string>): { text: string | null; replaced: number } {
  const rx = idMatcher(map)
  if (!rx) return { text: null, replaced: 0 }
  let replaced = 0
  const swap = (s: string) => s.replace(rx, (m) => {
    const next = map[m]
    if (!next) return m
    replaced++
    return next
  })
  if (path.endsWith('.jsonl')) {
    const lines = text.split('\n').map((line) => {
      if (!line.trim()) return line
      try { return JSON.stringify(rewriteValue(JSON.parse(line), swap)) } catch { return swap(line) }
    })
    return { text: replaced ? lines.join('\n') : null, replaced }
  }
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { return { text: null, replaced: 0 } } // not JSON after all: never guess
  const next = rewriteValue(parsed, swap)
  if (!replaced) return { text: null, replaced: 0 }
  const indent = /^[[{]\r?\n( +)/.exec(text)?.[1]?.length
  return { text: JSON.stringify(next, null, indent) + (text.endsWith('\n') ? '\n' : ''), replaced }
}

// ── Runner over a data dir ──────────────────────────────────────────────────

export const MAP_FILE_REL = join('jticket', 'id-migration.json')

// Directories never walked: reviewers' git checkouts (someone's repo, not our
// state) and dot-dirs.
const SKIP_DIRS = new Set([join('jreview', 'worktrees')])

/** Every .json/.jsonl file under the dir, relative paths, the map file excluded. */
export function dataFiles(dataDir: string): string[] {
  const out: string[] = []
  const visit = (rel: string) => {
    for (const ent of readdirSync(join(dataDir, rel), { withFileTypes: true })) {
      const r = rel ? join(rel, ent.name) : ent.name
      if (ent.isDirectory()) {
        if (!ent.name.startsWith('.') && !SKIP_DIRS.has(r)) visit(r)
      } else if (ent.isFile() && /\.jsonl?$/.test(ent.name) && r !== MAP_FILE_REL) {
        out.push(r)
      }
    }
  }
  visit('')
  return out.sort()
}

export interface IdMigrationResult {
  dryRun: boolean
  /** Nothing to do: no legacy id left anywhere (a second run). */
  noop: boolean
  dataDir: string
  /** The copy of the whole data dir taken before writing ('' on a dry run / no-op). */
  backupDir: string
  mapFile: string
  /** Legacy ids newly mapped, by prefix ({ tick: 863, … }). */
  added: Record<string, number>
  /** Files that changed (or would), with their replacement counts. */
  files: Array<{ path: string; replaced: number }>
  /** A few old → new pairs, for eyeballing. */
  sample: Array<[string, string]>
}

function readMapFile(file: string): IdMigrationRecord {
  if (!existsSync(file)) return { version: 1, runs: [], map: {} }
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<IdMigrationRecord>
  return { version: 1, runs: parsed.runs ?? [], map: parsed.map ?? {} }
}

// Write beside, then rename over: a crash mid-write never leaves half a file.
function writeAtomic(file: string, text: string): void {
  const tmp = `${file}.ids-tmp-${process.pid}`
  writeFileSync(tmp, text, 'utf8')
  renameSync(tmp, file)
}

/**
 * Migrate every legacy id under `dataDir`. Entirely synchronous on purpose:
 * run inside the server, no request can read or write the store halfway.
 *
 * Order: plan → (dry run stops here) → copy the whole dir to
 * `<dataDir>.backup-ids-<stamp>` → save the map (so legacy lookups work the
 * instant any file has moved) → rewrite each changed file atomically.
 */
export function migrateIdsInDir(dataDir: string, opts: { dryRun?: boolean; at?: Date } = {}): IdMigrationResult {
  const at = opts.at ?? new Date()
  const dryRun = opts.dryRun === true
  const mapFile = join(dataDir, MAP_FILE_REL)
  const record = readMapFile(mapFile)
  const files = dataFiles(dataDir).map((path) => ({ path, text: readFileSync(join(dataDir, path), 'utf8') }))
  const plan = planIdMigration(files, record.map, at.getTime())

  const changed: Array<{ path: string; text: string; replaced: number }> = []
  for (const f of files) {
    const r = rewriteIdsInText(f.path, f.text, plan.map)
    if (r.text !== null) changed.push({ path: f.path, text: r.text, replaced: r.replaced })
  }
  const added: Record<string, number> = {}
  for (const id of plan.added) {
    const prefix = id.slice(0, id.indexOf('_'))
    added[prefix] = (added[prefix] ?? 0) + 1
  }
  const result: IdMigrationResult = {
    dryRun,
    noop: !plan.added.length && !changed.length,
    dataDir,
    backupDir: '',
    mapFile,
    added,
    files: changed.map(({ path, replaced }) => ({ path, replaced })),
    sample: plan.added.slice(0, 5).map((id) => [id, plan.map[id]!]),
  }
  if (dryRun || result.noop) return result

  const stamp = at.toISOString().replace(/[:.]/g, '-')
  result.backupDir = `${dataDir.replace(/\/+$/, '')}.backup-ids-${stamp}`
  cpSync(dataDir, result.backupDir, { recursive: true, errorOnExist: true, force: false })

  record.map = plan.map
  record.runs.push({ at: at.toISOString(), backupDir: result.backupDir, added: plan.added.length })
  writeAtomic(mapFile, JSON.stringify(record, null, 2) + '\n')
  for (const c of changed) writeAtomic(join(dataDir, c.path), c.text)
  return result
}

