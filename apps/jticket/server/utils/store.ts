import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { appDataFile } from '@jsuite/data'

// ── Types ─────────────────────────────────────────────────────────────────
export type TicketType = 'AFK' | 'HITL'
// 'done' = the work is built and recorded; 'merged' = its local PR has landed
// on the integration branch. Both count as finished — see isFinishedStatus.
export type TicketStatus = 'todo' | 'in_progress' | 'done' | 'merged'
export type DocStatus = 'draft' | 'ready'
// A local PR's lifecycle. 'conflicted' is a failed merge attempt — the repo was
// left untouched; rebase the head branch and merge again.
export type LocalPrStatus = 'open' | 'conflicted' | 'merged' | 'closed'
// A project is either a plain tracker or a wayfinder effort. In 'wayfinder'
// mode the project description is the wayfinder *map* body and its tickets are
// grouped into frontier / blocked / done.
export type ProjectMode = 'standard' | 'wayfinder'

export interface Project {
  id: string
  key: string // PROJ-1
  title: string
  description: string
  mode: ProjectMode
  // GitHub integration (both '' when the project isn't wired to a repo).
  // `repo` is a path to a LOCAL clone ('~' allowed) — the same thing jDiff
  // takes as ?repo=, so a PR row can link straight into it.
  repo: string
  // The project's integration branch: an empty branch cut from the default
  // branch that the project's PRs target, and which lands as one PR when the
  // project is done. See server/utils/github.ts.
  integrationBranch: string
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
  projectId: string | null // parent project; null = backlog
  assignee: string // who is working on it — free-form name (e.g. an agent id); '' = unassigned
  labels: string[] // e.g. 'wayfinder:research' — the wayfinder sub-type
  resolution: string // the answer, recorded on resolution (jdoc); '' until resolved
  blockedBy: string[] // ticket ids that gate this one
  comments: TicketComment[] // append via POST /api/tickets/:id/comments, never PATCH
  // The ticket's work branch in the project's repo — cut locally off the
  // integration branch (POST /api/tickets/:id/branch) and never pushed; a local
  // PR's default head. '' until cut.
  branch: string
  // When the ticket last became done. Stamped on the todo/in_progress → done
  // transition and cleared when it moves back out; null while unfinished. Kept
  // separate from updatedAt, which any edit bumps — this is what /finished
  // orders by. Never set directly by callers; see stampCompletion.
  completedAt: string | null
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

// A local pull request: the ticket-sized unit of review, tracked entirely in
// this store and merged by jTicket itself (a squash onto the integration
// branch, done with git plumbing so the working tree is never touched). Git
// holds the code; this record holds the story — title, ticket, lifecycle.
// Exactly one ticket per PR; the merge is what moves that ticket to 'merged'.
export interface LocalPr {
  id: string
  key: string // PR-1
  title: string
  description: string // GFM markdown — becomes the squash commit body
  ticketId: string
  projectId: string
  headBranch: string // the ticket branch (kept on record after the merge deletes it)
  baseBranch: string // the integration branch the PR targets
  status: LocalPrStatus
  // Files the last failed merge attempt conflicted on; [] unless 'conflicted'.
  conflictFiles: string[]
  mergeCommit: string // oid of the squash commit, '' until merged
  mergedAt: string | null
  createdAt: string
  updatedAt: string
}

// A repo jTicket has been pointed at before. Kept so setting up the next
// project is a click rather than a retyped path — the list is server-side (not
// per-browser) so agents driving the HTTP API see it too. `slug` and
// `defaultBranch` are best-effort: '' until a `gh` call has filled them in.
export interface KnownRepo {
  path: string // absolute, resolved ('~' already expanded)
  slug: string // 'owner/name', '' when gh can't say
  defaultBranch: string
  lastUsedAt: string
}

export interface Store {
  projects: Project[]
  tickets: Ticket[]
  docs: Doc[]
  prs: LocalPr[]
  repos: KnownRepo[] // repos used before — see rememberRepo
  counters: { project: number; ticket: number; doc: number; pr: number }
}

// ── Persistence ─────────────────────────────────────────────────────────────
// A single human-editable JSON file at <monorepo root>/.data/jticket/jticket.json.
// Exported because the change watcher (changes.ts) tails this exact file — every
// write, from the API or from a text editor, is a change worth broadcasting.
export const DATA_FILE = appDataFile('jticket', 'jticket.json')

function emptyStore(): Store {
  return {
    projects: [],
    tickets: [],
    docs: [],
    prs: [],
    repos: [],
    counters: { project: 0, ticket: 0, doc: 0, pr: 0 },
  }
}

// The shape older files (and bundles) may still carry: an epic layer between
// projects and tickets, folded away by loadStore — see migrateEpics.
interface LegacyEpic {
  id: string
  description?: string
  projectId?: string | null
}
type LegacyStore = Partial<Store> & {
  epics?: LegacyEpic[]
  tickets?: Array<Ticket & { epicId?: string | null }>
  counters?: Partial<Store['counters']> & { epic?: number }
}

// Stores written before the epic layer was removed: tickets adopt their epic's
// project, and each epic's body (the wayfinder map, or a plain description)
// is appended to the project description so nothing written there is lost.
// Runs only while `epics` is present — the first save drops the array, so the
// fold-in never applies twice.
function migrateEpics(parsed: LegacyStore): void {
  if (!parsed.epics?.length) return
  const byId = new Map(parsed.epics.map((e) => [e.id, e]))
  for (const t of parsed.tickets ?? []) {
    if (t.projectId === undefined) t.projectId = (t.epicId && byId.get(t.epicId)?.projectId) || null
    delete t.epicId
  }
  for (const p of parsed.projects ?? []) {
    for (const e of parsed.epics) {
      const body = e.description?.trim()
      if (e.projectId !== p.id || !body) continue
      p.description = p.description?.trim() ? `${p.description.trim()}\n\n${body}` : body
    }
  }
  delete parsed.epics
}

export function loadStore(): Store {
  if (!existsSync(DATA_FILE)) return emptyStore()
  try {
    const parsed = JSON.parse(readFileSync(DATA_FILE, 'utf8')) as LegacyStore
    migrateEpics(parsed)
    return {
      // Projects predating wayfinder mode default to 'standard'; those
      // predating the GitHub link have no repo and no integration branch.
      projects: (parsed.projects ?? []).map((p) => ({
        ...p,
        mode: p.mode === 'wayfinder' ? 'wayfinder' : 'standard',
        repo: p.repo ?? '',
        integrationBranch: p.integrationBranch ?? '',
      })),
      // Tickets predating the assignee / label / resolution / comment fields get defaults.
      // Tickets already done before completedAt existed fall back to updatedAt —
      // the closest thing on record to when they finished.
      tickets: (parsed.tickets ?? []).map((t) => ({
        ...t,
        projectId: t.projectId ?? null,
        assignee: t.assignee ?? '',
        labels: t.labels ?? [],
        resolution: t.resolution ?? '',
        comments: t.comments ?? [],
        branch: t.branch ?? '',
        completedAt: t.completedAt ?? (isFinishedStatus(t.status) ? t.updatedAt : null),
      })),
      // Docs predating the shared-document system carried an inline jdoc body;
      // those were migrated into the shared pool (documentKey references).
      docs: (parsed.docs ?? []).map((d) => ({ ...d, documentKey: d.documentKey ?? '' })),
      // Local PRs postdate everything else; absent = none yet.
      prs: (parsed.prs ?? []).map((pr) => ({
        ...pr,
        conflictFiles: pr.conflictFiles ?? [],
        mergeCommit: pr.mergeCommit ?? '',
        mergedAt: pr.mergedAt ?? null,
      })),
      // The remembered-repo list postdates everything else; absent = none yet.
      repos: (parsed.repos ?? []).map((r) => ({
        path: String(r.path ?? ''),
        slug: r.slug ?? '',
        defaultBranch: r.defaultBranch ?? '',
        lastUsedAt: r.lastUsedAt ?? '',
      })).filter((r) => r.path),
      counters: {
        project: parsed.counters?.project ?? 0,
        ticket: parsed.counters?.ticket ?? 0,
        doc: parsed.counters?.doc ?? 0,
        pr: parsed.counters?.pr ?? 0,
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

const KEY_PREFIX: Record<'project' | 'ticket' | 'doc' | 'pr', string> = {
  project: 'PROJ',
  ticket: 'TICK',
  doc: 'DOC',
  pr: 'PR',
}

export function nextKey(store: Store, kind: 'project' | 'ticket' | 'doc' | 'pr'): string {
  store.counters[kind] += 1
  return `${KEY_PREFIX[kind]}-${store.counters[kind]}`
}

export function isStatus(v: unknown): v is TicketStatus {
  return v === 'todo' || v === 'in_progress' || v === 'done' || v === 'merged'
}

// Both terminal states count as finished: 'done' answers "is the work built?"
// and 'merged' additionally says its PR landed. Everything that used to ask
// `status === 'done'` — blocking, the frontier's complement, /finished — asks
// this instead.
export function isFinishedStatus(v: unknown): v is 'done' | 'merged' {
  return v === 'done' || v === 'merged'
}

export function isDocStatus(v: unknown): v is DocStatus {
  return v === 'draft' || v === 'ready'
}

// The single place a completion timestamp is decided. Moving into a finished
// status stamps the moment; moving out clears it; a ticket staying finished
// (done → merged, or editing a resolution) keeps the original stamp, so nothing
// shuffles to the top of "Recently finished".
export function stampCompletion(ticket: Ticket, nextStatus: TicketStatus, ts: string): string | null {
  if (!isFinishedStatus(nextStatus)) return null
  return ticket.completedAt ?? ts
}

// Accepts a project id, key, or exact title and returns the project (docs and
// import both let callers reference projects loosely).
export function findProjectRef(store: Store, ref: unknown): Project | undefined {
  if (typeof ref !== 'string' || !ref) return undefined
  return store.projects.find((p) => p.id === ref || p.key === ref || p.title === ref)
}

// ── Known repos ─────────────────────────────────────────────────────────────
/**
 * Upsert a repo into the remembered list. Only ever *adds* information: a
 * caller that knows nothing but the path (a bare project PATCH) won't blank a
 * slug some earlier `gh` call resolved.
 *
 * Returns true when the store actually changed, so read-mostly callers can
 * skip the write — GET endpoints that enrich a record must not rewrite the
 * store on every page view.
 */
export function rememberRepo(
  store: Store,
  rec: { path: string; slug?: string; defaultBranch?: string },
  opts: { touch?: boolean } = {},
): boolean {
  const path = rec.path.trim()
  if (!path) return false
  const touch = opts.touch ?? true
  const existing = store.repos.find((r) => r.path === path)
  if (!existing) {
    store.repos.push({
      path,
      slug: rec.slug ?? '',
      defaultBranch: rec.defaultBranch ?? '',
      lastUsedAt: now(),
    })
    return true
  }
  let changed = false
  if (rec.slug && rec.slug !== existing.slug) { existing.slug = rec.slug; changed = true }
  if (rec.defaultBranch && rec.defaultBranch !== existing.defaultBranch) {
    existing.defaultBranch = rec.defaultBranch
    changed = true
  }
  if (touch) { existing.lastUsedAt = now(); changed = true }
  return changed
}

/** Drop a repo from the remembered list. Returns true if one was there. */
export function forgetRepo(store: Store, path: string): boolean {
  const before = store.repos.length
  store.repos = store.repos.filter((r) => r.path !== path.trim())
  return store.repos.length !== before
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
// A ticket is blocked while any ticket it depends on is not yet finished.
export function ticketIsBlocked(ticket: Ticket, all: Ticket[]): boolean {
  return ticket.blockedBy.some((id) => {
    const dep = all.find((t) => t.id === id)
    return dep ? !isFinishedStatus(dep.status) : false
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

// Newest completion first — the order "Recently finished" reads in. Tickets
// with no stamp (never finished) sort last.
export function byCompletedAtDesc(a: Ticket, b: Ticket): number {
  return (b.completedAt ?? '').localeCompare(a.completedAt ?? '')
}

// Order by the numeric suffix of the key (TICK-9 before TICK-10) — the order
// wayfinder walks the frontier in.
export function byKeyNumber(a: { key: string }, b: { key: string }): number {
  const n = (k: string) => Number.parseInt(k.split('-')[1] ?? '0', 10)
  return n(a.key) - n(b.key)
}
