// jTicket's vocabulary — the record shapes, declared once for both sides.
//
// Nuxt's `shared/` is visible to `app/` and `server/` alike (`#shared/...`, and
// auto-imported), which is the whole point of this file: a ticket, a project
// and an attachment are the same shape whether the server is writing one to
// disk or a component is rendering one, so adding a field is one edit here,
// not one here and one in a hand-kept client copy that nothing checks.
//
// What belongs here: what jTicket's records *are*. What doesn't:
//   - persistence — the store file's shape, migrations, key counters: server
//     only, in server/utils/store.ts
//   - view meta — labels, icons, colours: client only, in
//     app/composables/useTracker.ts
// The rules read off these shapes (blocked, frontier, ordering) are shared too,
// next door in shared/utils/tracker.ts.

export type TicketType = 'AFK' | 'HITL'
export type TicketStatus = 'todo' | 'in_progress' | 'done'

// A project is either a plain tracker or a wayfinder effort. In 'wayfinder'
// mode the project description is the wayfinder *map* body and its tickets are
// grouped into frontier / blocked / done.
export type ProjectMode = 'standard' | 'wayfinder'

// Inside a wayfinder project a ticket also has a *sub-type*: what kind of
// unknown it closes. It is carried as a 'wayfinder:<type>' label rather than a
// field, so a standard ticket never has to hold one — see the wayfinder helpers
// in shared/utils/tracker.ts, which are the only things that read or write it.
// Shared because /api/import accepts one and must reject a type no screen could
// render; the icons and colours per type stay client-side in useTracker.ts.
export type WayfinderType = 'research' | 'prototype' | 'grilling' | 'task'

// ── Attachments ─────────────────────────────────────────────────────────────
// jTicket owns the ticket↔artifact link. An attachment is a *reference* into
// one of the shared pools — never a copy — so the pools (and the apps that
// own them) stay completely ignorant of tickets. The artifact is the source of
// truth for its own title and content; all we keep is which one, and of what
// kind.
export type AttachmentType = 'document' | 'chart' | 'diff'

export interface Attachment {
  type: AttachmentType
  // What `id` means, per type:
  //   document → key in the shared document pool (.data/jexplain/<id>.json)
  //   chart    → key in the shared chart pool (.data/jchart/<id>.json)
  //   diff     → a jDiff review target: a PR number ('123') or 'branch/<name>',
  //              read against the repo of the project the attachment hangs off
  id: string
}

/**
 * A ref plus what the artifact says about itself, read fresh from its pool —
 * what GET /api/{tickets,projects}/:id/attachments returns, one row per ref.
 * Never persisted: resolving reads the pools on every call, and a ref whose
 * artifact has gone comes back `missing`, which is a state to render rather
 * than an error. See server/utils/artifacts.ts, which builds these.
 */
export interface ResolvedAttachment extends Attachment {
  /** The artifact's own title, or a readable stand-in when there's nothing to read. */
  title: string
  /**
   * Where to open it, in-app: jTicket serves all three pools' UI itself,
   * through @jsuite/documents, @jsuite/charting and @jsuite/diff. '' if
   * missing.
   */
  url: string
  /** The artifact's last write, when the pool records one. '' for a diff, which has no file. */
  updatedAt: string
  /**
   * True when there is nothing to open. Two different situations land here, and
   * `reason` is what tells them apart:
   *   - the artifact is gone — deleted out from under the ref, or never created
   *   - a diff ref has no repo to be read against (its project has none, or the
   *     ticket is in the backlog and so has no project at all)
   * Note a diff's target is *not* verified: the review engine resolves a PR
   * number or branch lazily against git and gh, which is far too expensive to
   * do per ref on a page load. `missing: false` on a diff therefore means "we
   * know where to send you", not "the branch still exists" — whatever renders
   * one has to cope with a target that turns out not to be there.
   */
  missing: boolean
  /** Why it's missing, for a UI that wants to say more than "missing". */
  reason?: string
  /**
   * The repo a `diff` was resolved against, as the project stores it — what the
   * review engine takes as `?repo=`. Only diffs have one, and only a renderer
   * that mounts the review itself (rather than following `url`) needs it.
   */
  repo?: string
}

// ── Records ─────────────────────────────────────────────────────────────────

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
  // project is done. See server/utils/github.ts and <ProjectGithub>.
  integrationBranch: string
  attachments: Attachment[] // artifacts linked to this project — see Attachment
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
  attachments: Attachment[] // artifacts linked to this ticket — see Attachment
  // When the ticket last became done. Stamped on the todo/in_progress → done
  // transition and cleared when it moves back out; null while unfinished. Kept
  // separate from updatedAt, which any edit bumps — this is what /finished
  // orders by. Never set directly by callers; see stampCompletion.
  completedAt: string | null
  createdAt: string
  updatedAt: string
}

/**
 * The flags the ticket GET endpoints attach to every row so a caller (an agent,
 * mostly) never has to recompute the frontier. Computed per request from the
 * whole board and never persisted, which is why they are a separate shape:
 * a `Ticket` on its own — one being edited in a form, one about to be saved —
 * genuinely has no answer for them. See withDerived, and isBlocked/isFrontier
 * in shared/utils/tracker.ts, which are the same rules the board runs locally.
 */
export interface TicketDerived {
  blocked: boolean
  claimed: boolean
  frontier: boolean
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
