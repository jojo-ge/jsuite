import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { appDataFile } from '@jsuite/data'

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
  documentKey: string // key into the shared document pool
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
// A single human-editable JSON file at <monorepo root>/.data/jticket/jticket.json.
const DATA_FILE = appDataFile('jticket', 'jticket.json')

function emptyStore(): Store {
  return {
    projects: [],
    epics: [],
    tickets: [],
    docs: [],
    counters: { project: 0, epic: 0, ticket: 0, doc: 0 },
  }
}

export function loadStore(): Store {
  if (!existsSync(DATA_FILE)) return emptyStore()
  try {
    const parsed = JSON.parse(readFileSync(DATA_FILE, 'utf8')) as Partial<Store>
    return {
      // Projects predating wayfinder mode default to 'standard'.
      projects: (parsed.projects ?? []).map((p) => ({ ...p, mode: p.mode === 'wayfinder' ? 'wayfinder' : 'standard' })),
      // Epics predating the project/label layers get sensible defaults.
      epics: (parsed.epics ?? []).map((e) => ({ ...e, projectId: e.projectId ?? null, labels: e.labels ?? [] })),
      // Tickets predating the assignee / label / resolution fields get defaults.
      tickets: (parsed.tickets ?? []).map((t) => ({
        ...t,
        assignee: t.assignee ?? '',
        labels: t.labels ?? [],
        resolution: t.resolution ?? '',
      })),
      // Docs predating the shared-document system carried an inline jdoc body;
      // those were migrated into the shared pool (documentKey references).
      docs: (parsed.docs ?? []).map((d) => ({ ...d, documentKey: d.documentKey ?? '' })),
      counters: {
        project: parsed.counters?.project ?? 0,
        epic: parsed.counters?.epic ?? 0,
        ticket: parsed.counters?.ticket ?? 0,
        doc: parsed.counters?.doc ?? 0,
      },
    }
  } catch {
    return emptyStore()
  }
}

export function saveStore(store: Store): void {
  mkdirSync(dirname(DATA_FILE), { recursive: true })
  writeFileSync(DATA_FILE, JSON.stringify(store, null, 2) + '\n', 'utf8')
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
