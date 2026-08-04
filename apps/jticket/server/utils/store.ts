import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { appDataDir, appDataFile } from '@jsuite/data'
import { snapshotData } from '@jsuite/data/history'

// ── Types ─────────────────────────────────────────────────────────────────
export type TicketType = 'AFK' | 'HITL'
export type TicketStatus = 'todo' | 'in_progress' | 'done'
export type DocStatus = 'draft' | 'ready'
// A project is either a plain tracker or a wayfinder effort. In 'wayfinder'
// mode each epic is treated as a wayfinder *map* (its description is the map
// body) and its tickets are grouped into frontier / blocked / done.
export type ProjectMode = 'standard' | 'wayfinder'

export interface Project {
  id: string
  key: string // PROJ-1
  title: string
  description: string
  mode: ProjectMode
  createdAt: string
  updatedAt: string
}

export interface Epic {
  id: string
  key: string // EPIC-1
  title: string
  description: string
  projectId: string | null // parent project
  labels: string[] // e.g. 'wayfinder:map'
  createdAt: string
  updatedAt: string
}

// A comment on a ticket. The human leaves direction here before handing the
// ticket to an LLM; LLMs post progress notes and questions under their own
// name. The resolution stays the ticket's single final answer.
export interface TicketComment {
  id: string
  author: string // free-form name, same convention as assignee
  body: string // GFM markdown
  createdAt: string
}

export interface Ticket {
  id: string
  key: string // TICK-1
  title: string
  description: string // "what to build" / the wayfinder question
  acceptanceCriteria: string[]
  type: TicketType
  status: TicketStatus
  epicId: string | null // parent epic
  assignee: string // who is working on it — free-form name (e.g. an agent id); '' = unassigned
  labels: string[] // e.g. 'wayfinder:research' — the wayfinder sub-type
  resolution: string // the answer, recorded on resolution (jdoc); '' until resolved
  blockedBy: string[] // ticket ids that gate this one
  comments: TicketComment[] // append via POST /api/tickets/:id/comments, never PATCH
  createdAt: string
  updatedAt: string
}

// A tracker record wrapping a document in the shared @jsuite/documents pool
// (the jExplain block format, stored in .data/jexplain/<documentKey>.json).
// The record carries the tracker-side metadata (project, labels, status);
// the content — title page, blocks, glossary — lives in the shared document,
// which jExplain lists and renders too. Never posted anywhere external.
export interface Doc {
  id: string
  key: string // DOC-1
  title: string
  documentKey: string // slug address into the shared document pool — follows the title, can be re-pointed
  documentId: string // stable identity of that document; survives renames and re-slugging
  projectId: string | null // optional parent project
  labels: string[]
  status: DocStatus
  createdAt: string
  updatedAt: string
}

export interface Store {
  projects: Project[]
  epics: Epic[]
  tickets: Ticket[]
  docs: Doc[]
  counters: { project: number; epic: number; ticket: number; doc: number }
}

// ── Persistence ─────────────────────────────────────────────────────────────
// One JSON file per entity under <monorepo root>/.data/jticket/:
//
//   projects/PROJ-2.json   epics/EPIC-2.json   tickets/TICK-5.json
//   docs/DOC-2.json        counters.json
//
// The file *name* is the display key because that's what makes the tree
// browsable — an agent can open tickets/TICK-5.json without an index. The file
// *contents* carry `id`, which is the identity everything else matches on.
//
// This used to be a single jticket.json holding every entity, which meant any
// write rewrote the whole tracker: one edit could not be told apart from
// another, so two people (or an editor and an agent) could not touch different
// tickets without one clobbering the other. Per-entity files make a change to
// TICK-5 a change to exactly one file.
const DATA_DIR = () => appDataDir('jticket')
const LEGACY_FILE = () => appDataFile('jticket', 'jticket.json')
const COUNTERS_FILE = () => join(DATA_DIR(), 'counters.json')

type Kind = 'project' | 'epic' | 'ticket' | 'doc'
const DIR: Record<Kind, string> = {
  project: 'projects',
  epic: 'epics',
  ticket: 'tickets',
  doc: 'docs',
}

// What was on disk when this store was loaded: relative path -> file contents.
// saveStore diffs against it so a request that touches one ticket writes one
// file. Keyed by the store object itself, so concurrent handlers each diff
// against their own snapshot.
const snapshots = new WeakMap<Store, Map<string, string>>()

function entityFileName(entity: { id: string; key?: string }): string {
  const base = String(entity.key || entity.id).replace(/[^A-Za-z0-9._-]+/g, '-')
  return `${base}.json`
}

const serialise = (value: unknown) => JSON.stringify(value, null, 2) + '\n'

function writeFileAtomic(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true })
  // Write-then-rename so a reader (jTicket's own UI, an agent, a file watcher)
  // never observes a half-written entity.
  const tmp = `${path}.tmp`
  writeFileSync(tmp, contents, 'utf8')
  renameSync(tmp, path)
}

function readEntities<T>(kind: Kind): T[] {
  const dir = join(DATA_DIR(), DIR[kind])
  if (!existsSync(dir)) return []
  const out: T[] = []
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.json') || file.endsWith('.tmp')) continue
    try {
      out.push(JSON.parse(readFileSync(join(dir, file), 'utf8')) as T)
    } catch {
      // An unparseable entity is skipped rather than taking the tracker down.
    }
  }
  return out
}

function emptyStore(): Store {
  return {
    projects: [],
    epics: [],
    tickets: [],
    docs: [],
    counters: { project: 0, epic: 0, ticket: 0, doc: 0 },
  }
}

// Field defaults for records written by older versions. Applied on read so the
// rest of the app can treat every field as present.
function normalise(store: Partial<Store>): Store {
  return {
    // Projects predating wayfinder mode default to 'standard'.
    projects: (store.projects ?? [])
      .map((p) => ({ ...p, mode: p.mode === 'wayfinder' ? 'wayfinder' : 'standard' }))
      .sort(byKeyNumber),
    // Epics predating the project/label layers get sensible defaults.
    epics: (store.epics ?? []).map((e) => ({ ...e, projectId: e.projectId ?? null, labels: e.labels ?? [] })).sort(byKeyNumber),
    // Tickets predating the assignee / label / resolution / comment fields get defaults.
    tickets: (store.tickets ?? [])
      .map((t) => ({
        ...t,
        assignee: t.assignee ?? '',
        labels: t.labels ?? [],
        resolution: t.resolution ?? '',
        comments: t.comments ?? [],
      }))
      .sort(byKeyNumber),
    // Docs predating the shared-document system carried an inline jdoc body;
    // those were migrated into the shared pool (documentKey references).
    // documentId backfills lazily — see resolveDocumentIds below.
    docs: (store.docs ?? []).map((d) => ({ ...d, documentKey: d.documentKey ?? '', documentId: d.documentId ?? '' })).sort(byKeyNumber),
    counters: {
      project: store.counters?.project ?? 0,
      epic: store.counters?.epic ?? 0,
      ticket: store.counters?.ticket ?? 0,
      doc: store.counters?.doc ?? 0,
    },
  }
}

/**
 * One-time move from the single jticket.json to per-entity files. Runs on the
 * first load that finds the legacy file, and leaves it renamed rather than
 * deleted — this is somebody's tracker.
 */
function migrateFromLegacyFile(): Store | null {
  const legacy = LEGACY_FILE()
  if (!existsSync(legacy)) return null
  let parsed: Partial<Store>
  try {
    parsed = JSON.parse(readFileSync(legacy, 'utf8')) as Partial<Store>
  } catch {
    return null // Leave the file alone; a corrupt tracker is not ours to discard.
  }
  const store = normalise(parsed)
  writeAll(store)
  renameSync(legacy, `${legacy}.pre-split.bak`)
  return store
}

function writeAll(store: Store): void {
  for (const [kind, entities] of [
    ['project', store.projects],
    ['epic', store.epics],
    ['ticket', store.tickets],
    ['doc', store.docs],
  ] as const) {
    for (const entity of entities) {
      writeFileAtomic(join(DATA_DIR(), DIR[kind], entityFileName(entity)), serialise(entity))
    }
  }
  writeFileAtomic(COUNTERS_FILE(), serialise(store.counters))
}

function snapshotOf(store: Store): Map<string, string> {
  const snap = new Map<string, string>()
  for (const [kind, entities] of [
    ['project', store.projects],
    ['epic', store.epics],
    ['ticket', store.tickets],
    ['doc', store.docs],
  ] as const) {
    for (const entity of entities) {
      snap.set(`${DIR[kind]}/${entityFileName(entity)}`, serialise(entity))
    }
  }
  snap.set('counters.json', serialise(store.counters))
  return snap
}

export function loadStore(): Store {
  const migrated = migrateFromLegacyFile()
  const store =
    migrated ??
    normalise({
      projects: readEntities<Project>('project'),
      epics: readEntities<Epic>('epic'),
      tickets: readEntities<Ticket>('ticket'),
      docs: readEntities<Doc>('doc'),
      counters: existsSync(COUNTERS_FILE())
        ? (JSON.parse(readFileSync(COUNTERS_FILE(), 'utf8')) as Store['counters'])
        : undefined,
    })
  snapshots.set(store, snapshotOf(store))
  return store
}

/**
 * Persist only what changed since loadStore(). Entities that vanished from the
 * store have their files removed, and an entity whose key changed moves file.
 */
export function saveStore(store: Store): void {
  const before = snapshots.get(store) ?? new Map<string, string>()
  const after = snapshotOf(store)
  const touched: string[] = []

  for (const [relative, contents] of after) {
    if (before.get(relative) === contents) continue
    writeFileAtomic(join(DATA_DIR(), relative), contents)
    touched.push(relative)
  }
  for (const relative of before.keys()) {
    if (after.has(relative)) continue
    const path = join(DATA_DIR(), relative)
    if (existsSync(path)) rmSync(path)
    touched.push(relative)
  }

  snapshots.set(store, after)

  // counters.json moves on nearly every write; naming it in the commit subject
  // would drown out the entity that actually changed.
  const named = touched.filter((t) => t !== 'counters.json')
  if (named.length) snapshotData(`jticket: ${named.map((t) => t.replace(/^\w+\/|\.json$/g, '')).join(', ')}`)
}

// ── Helpers ──────────────────────────────────────────────────────────────────
export function now(): string {
  return new Date().toISOString()
}

export function newId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`
}

const KEY_PREFIX: Record<'project' | 'epic' | 'ticket' | 'doc', string> = {
  project: 'PROJ',
  epic: 'EPIC',
  ticket: 'TICK',
  doc: 'DOC',
}

export function nextKey(store: Store, kind: 'project' | 'epic' | 'ticket' | 'doc'): string {
  store.counters[kind] += 1
  return `${KEY_PREFIX[kind]}-${store.counters[kind]}`
}

export function isStatus(v: unknown): v is TicketStatus {
  return v === 'todo' || v === 'in_progress' || v === 'done'
}

export function isDocStatus(v: unknown): v is DocStatus {
  return v === 'draft' || v === 'ready'
}

// Accepts a project id, key, or exact title and returns the project (docs and
// import both let callers reference projects loosely).
export function findProjectRef(store: Store, ref: unknown): Project | undefined {
  if (typeof ref !== 'string' || !ref) return undefined
  return store.projects.find((p) => p.id === ref || p.key === ref || p.title === ref)
}

export function cleanLabels(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return [...new Set(v.map((s) => String(s).trim()).filter(Boolean))]
}

// Accepts an array of ticket ids or keys and returns the matching ticket ids,
// de-duplicated and with unknown refs dropped.
export function resolveTicketRefs(store: Store, refs: unknown[]): string[] {
  const out = new Set<string>()
  for (const ref of refs ?? []) {
    const t = store.tickets.find((x) => x.id === ref || x.key === ref)
    if (t) out.add(t.id)
  }
  return [...out]
}

// ── Derived ticket state (wayfinder) ───────────────────────────────────────
// A ticket is blocked while any ticket it depends on is not yet done.
export function ticketIsBlocked(ticket: Ticket, all: Ticket[]): boolean {
  return ticket.blockedBy.some((id) => {
    const dep = all.find((t) => t.id === id)
    return dep ? dep.status !== 'done' : false
  })
}

// The frontier: the takeable edge of a map — open, unblocked, and unclaimed.
export function ticketIsFrontier(ticket: Ticket, all: Ticket[]): boolean {
  return ticket.status === 'todo' && !ticket.assignee && !ticketIsBlocked(ticket, all)
}

export interface TicketDerived {
  blocked: boolean
  claimed: boolean
  frontier: boolean
}

// GET responses augment each ticket with derived flags so callers (agents)
// never have to recompute the frontier. Never persisted — computed per request.
export function withDerived(ticket: Ticket, all: Ticket[]): Ticket & TicketDerived {
  return {
    ...ticket,
    blocked: ticketIsBlocked(ticket, all),
    claimed: !!ticket.assignee,
    frontier: ticketIsFrontier(ticket, all),
  }
}

// Order by the numeric suffix of the key (TICK-9 before TICK-10) — the order
// wayfinder walks the frontier in.
export function byKeyNumber(a: { key: string }, b: { key: string }): number {
  const n = (k: string) => Number.parseInt(k.split('-')[1] ?? '0', 10)
  return n(a.key) - n(b.key)
}
