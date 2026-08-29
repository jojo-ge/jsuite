import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { appDataFile } from '@jsuite/data'
import { isPeerOwned } from './ownership'
import { cleanPromptOverrides, cleanPromptText, coercePromptMode } from './prompts'
import type { ProjectShare, ShareSide } from './ownership'
import type { PromptOverrides, TicketPromptMode } from './prompts'
import type { Share } from './shares'

export type { ProjectShare, ShareSide } from './ownership'

// ── Types ─────────────────────────────────────────────────────────────────
export type TicketType = 'AFK' | 'HITL'
// 'done' = the work is built and recorded; 'merged' = its local PR has landed
// on the integration branch. Both count as finished — see isFinishedStatus.
export type TicketStatus = 'todo' | 'in_progress' | 'done' | 'merged'
export type DocStatus = 'draft' | 'ready'
// Where a ticket stands in an ownership transfer (spec DOC-30): '' = not in
// transfer. 'pending' = offered to the peer and frozen — the record is
// identical on both machines (owner already names the transferee) until the
// transferee accepts (their copy becomes a normal owned ticket) or declines.
// 'declined' exists only on the decliner's machine: ownership is already
// bounced back (owner = the original side) and the marker travels to the
// transferor as a snapshot transferDecline until they revert and re-export.
export type TicketTransfer = '' | 'pending' | 'declined'
// A local PR's lifecycle. 'conflicted' is a failed merge attempt — the repo was
// left untouched; rebase the head branch and merge again.
export type LocalPrStatus = 'open' | 'conflicted' | 'merged' | 'closed'
// A project is a plain tracker, a wayfinder effort, a jMap codebase-mapping
// effort, a codebase's TODO list, an architecture review, or a pre-deploy
// bug sweep. In 'wayfinder'
// mode the project description is the wayfinder *map* body and its tickets are
// grouped into frontier / blocked / done. In 'jmap' mode the tickets are
// mapping jobs dispatched to herdr with /jmap-* commands (no branches, no PRs)
// and their output is docs the jMap app synthesizes. In 'todo' mode the
// project is its codebase's one running todo list — human-written one-liner
// tickets exercised with the Grill action (no branches, no PRs); made only by
// get-or-create (POST /api/projects/todo), one per codebase. In 'architect'
// mode the project is one architecture scan of its repo (made by POST
// /api/projects/architect): the arch:scan ticket dispatches /jarchitect-scan,
// which fills the board with HITL arch:candidate tickets — deepening
// opportunities whose herdr button dispatches /jarchitect-grill (no branches,
// no PRs; dispatching the grilling is the triage decision and moves the
// candidate to done). In 'predeploy' mode every ticket is one suspected bug
// standing between the repo and a deploy: its herdr button dispatches
// /jreproduce, which reproduces the bug in a throwaway worktree, records the
// failing test and the verdict on the ticket, and never implements the fix (no
// branches, no PRs — the worktree is torn down when it finishes).
export type ProjectMode = 'standard' | 'wayfinder' | 'jmap' | 'todo' | 'architect' | 'predeploy'

const PROJECT_MODES: ProjectMode[] = ['wayfinder', 'jmap', 'todo', 'architect', 'predeploy']

export function coerceProjectMode(mode: unknown): ProjectMode {
  return PROJECT_MODES.includes(mode as ProjectMode) ? (mode as ProjectMode) : 'standard'
}

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
  // Starred projects are the ones on deck: /next only surfaces frontier
  // tickets (and merge queues) from starred projects. Everything else about a
  // project is unaffected — its tickets still appear on /running, /finished
  // and the board.
  starred: boolean
  // Two-party sync (spec DOC-30): null = local-only, and everything behaves
  // exactly as before. When set, the project's entities are partitioned by
  // owner side and the peer's half is read-only here — see ownership.ts.
  share: ProjectShare | null
  // Per-project hand-off prompts, keyed by PromptKind — only the kinds this
  // project overrides are present; the rest fall through to the editable
  // global defaults and then to the code default (prompts.ts). Machine-local
  // like `repo`: never on the sync wire, editable on both sides of a share.
  prompts: PromptOverrides
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
  // Which side of a shared project wrote this comment ('' on local-only
  // projects). Comment sets merge per ticket during sync — each side may
  // comment on any ticket, but only its own comments are its to delete.
  origin: ShareSide | ''
  owner: ShareSide | ''
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
  // This ticket's own hand-off text and what to do with it: 'append' adds it
  // after the prompt its project/kind resolves to, 'replace' makes it the whole
  // prompt, '' leaves the resolved prompt alone (the text is kept either way,
  // so switching back doesn't lose the draft). Machine-local — see prompts.ts.
  prompt: string
  promptMode: TicketPromptMode
  // When the ticket last became done. Stamped on the todo/in_progress → done
  // transition and cleared when it moves back out; null while unfinished. Kept
  // separate from updatedAt, which any edit bumps — this is what /finished
  // orders by. Never set directly by callers; see stampCompletion.
  completedAt: string | null
  // Ownership on a shared project ('' / '' on local-only ones). `origin` is
  // the side that minted the ticket — immutable, it fixes the key's parity;
  // `owner` is whose half it lives in now (mutable only by ownership
  // transfer). Peer-owned = read-only and undispatchable here. Stamped at
  // creation (entityOwnership), never writable through PATCH.
  origin: ShareSide | ''
  owner: ShareSide | ''
  // Ownership-transfer state (see TicketTransfer). While 'pending' the ticket
  // is frozen — no edits, no dispatch, on either machine — and immune to
  // absence-deletion in sync. transferAt stamps the initiate and identifies
  // the offer: a decline names it, so a stale decline can't kill a re-offer.
  transfer: TicketTransfer
  transferAt: string
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
  // Ownership on a shared project ('' / '' on local-only ones) — same
  // partition as tickets, minus transfer (docs never change sides).
  origin: ShareSide | ''
  owner: ShareSide | ''
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
  // Oid of the squash commit's parent (the base tip it landed on), '' until
  // merged — keeps mergeParent..mergeCommit reviewable in jDiff after the
  // head branch is deleted.
  mergeParent: string
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
  shares: Share[] // at most one per shared project — see shares.ts
  // Suite-wide hand-off prompts (GET/PATCH /api/prompts): the layer projects
  // override and the code defaults back. Only overridden kinds are present.
  promptDefaults: PromptOverrides
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
    shares: [],
    promptDefaults: {},
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
        mode: coerceProjectMode(p.mode),
        repo: p.repo ?? '',
        integrationBranch: p.integrationBranch ?? '',
        starred: p.starred ?? false,
        // Projects predating (or never entering) sync are local-only.
        share: p.share ?? null,
        // Projects predating prompt overrides use the defaults for everything.
        prompts: cleanPromptOverrides(p.prompts),
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
        // Entities predating sync are unowned ('') — local, editable here.
        comments: (t.comments ?? []).map((c) => ({ ...c, origin: c.origin ?? '', owner: c.owner ?? '' })),
        branch: t.branch ?? '',
        // Tickets predating prompt overrides use their project's prompt.
        prompt: cleanPromptText(t.prompt),
        promptMode: coercePromptMode(t.promptMode),
        completedAt: t.completedAt ?? (isFinishedStatus(t.status) ? t.updatedAt : null),
        origin: t.origin ?? '',
        owner: t.owner ?? '',
        // Tickets predating ownership transfer aren't in one.
        transfer: t.transfer ?? '',
        transferAt: t.transferAt ?? '',
      })),
      // Docs predating the shared-document system carried an inline jdoc body;
      // those were migrated into the shared pool (documentKey references).
      docs: (parsed.docs ?? []).map((d) => ({
        ...d,
        documentKey: d.documentKey ?? '',
        origin: d.origin ?? '',
        owner: d.owner ?? '',
      })),
      // Local PRs postdate everything else; absent = none yet.
      prs: (parsed.prs ?? []).map((pr) => ({
        ...pr,
        conflictFiles: pr.conflictFiles ?? [],
        mergeCommit: pr.mergeCommit ?? '',
        // PRs merged before this field existed keep '' — their jDiff link
        // degrades to the base branch (localPrs.ts prJdiffUrl).
        mergeParent: pr.mergeParent ?? '',
        mergedAt: pr.mergedAt ?? null,
      })),
      // The remembered-repo list postdates everything else; absent = none yet.
      repos: (parsed.repos ?? []).map((r) => ({
        path: String(r.path ?? ''),
        slug: r.slug ?? '',
        defaultBranch: r.defaultBranch ?? '',
        lastUsedAt: r.lastUsedAt ?? '',
      })).filter((r) => r.path),
      // Shares postdate everything else; absent = nothing shared yet. Records
      // from before two-way sync have no reverse room — that direction
      // refuses until the share is re-armed (shares.ts serveRoom/pullRoom).
      shares: (parsed.shares ?? []).map((s) => ({
        ...s,
        reverseRoomId: s.reverseRoomId ?? '',
        reverseRoomSecret: s.reverseRoomSecret ?? '',
      })),
      // Editable global defaults postdate everything else; absent = every kind
      // still falls through to its code default.
      promptDefaults: cleanPromptOverrides(parsed.promptDefaults),
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

// The frontier: the takeable edge of a map — open, unblocked, unclaimed, not
// mid-ownership-transfer (a pending offer is frozen and undispatchable), and
// ours. The peer's half of a shared project is read-only and undispatchable
// here, so a settled peer-owned ticket is not takeable either — without its
// project's share to judge ownership against, an agent would pick one up and
// bounce straight off the API's 403. The share is required, like everywhere
// else ownership is judged — null (a backlog ticket, a local-only project)
// means there is no peer and the answer is exactly what it was before.
export function ticketIsFrontier(
  ticket: Ticket,
  all: Ticket[],
  share: ProjectShare | null | undefined,
): boolean {
  if (isPeerOwned(ticket, share)) return false
  return ticket.status === 'todo' && !ticket.assignee && !ticket.transfer && !ticketIsBlocked(ticket, all)
}

// The share a ticket's ownership is judged against — its project's, or null
// for the backlog and for local-only projects. Takes only what it reads, like
// the ownership helpers it feeds, so callers and tests can pass a slice.
export function shareForTicket(
  store: { projects: Array<Pick<Project, 'id' | 'share'>> },
  ticket: Pick<Ticket, 'projectId'>,
): ProjectShare | null {
  if (!ticket.projectId) return null
  return store.projects.find((p) => p.id === ticket.projectId)?.share ?? null
}

export interface TicketDerived {
  blocked: boolean
  claimed: boolean
  frontier: boolean
}

// GET responses augment each ticket with derived flags so callers (agents)
// never have to recompute the frontier. Never persisted — computed per request.
export function withDerived(
  ticket: Ticket,
  all: Ticket[],
  share: ProjectShare | null | undefined,
): Ticket & TicketDerived {
  return {
    ...ticket,
    blocked: ticketIsBlocked(ticket, all),
    claimed: !!ticket.assignee,
    frontier: ticketIsFrontier(ticket, all, share),
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
