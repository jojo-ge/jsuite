import type { ExplainerMeta } from '@jsuite/documents/types'

// Client-side mirror of the server types (see server/utils/store.ts).
export type TicketType = 'AFK' | 'HITL'
export type TicketStatus = 'todo' | 'in_progress' | 'done'
export type ProjectMode = 'standard' | 'wayfinder'

// An artifact reference — jTicket owns the ticket↔artifact link; the shared
// pools stay ticket-ignorant. `id` is a document or chart pool key, or a jDiff
// review target ('123' / 'branch/<name>'). See server/utils/store.ts.
export type AttachmentType = 'document' | 'chart' | 'diff'

export interface Attachment {
  type: AttachmentType
  id: string
}

// What GET /api/{tickets,projects}/:id/attachments returns: the ref plus what
// the artifact says about itself, read fresh from its pool. `missing` means the
// artifact is gone (or, for a diff, that there's no repo to read it against) —
// a state to render, not an error.
export interface ResolvedAttachment extends Attachment {
  title: string
  url: string
  updatedAt: string
  missing: boolean
  reason?: string
}

/**
 * Everything that differs by artifact type, in one place — so a new type is a
 * row here rather than a fresh `if (a.type === …)` in every component that
 * touches attachments.
 *
 * `page` is where the artifact's own full view lives *inside jTicket*; it is
 * null for a diff, which is the one artifact no layer renders — jDiff computes
 * it from git on demand, so the only thing to do with a diff is follow the
 * absolute `url` the server resolved out to jDiff. That same null is what
 * `embeds` would be telling us, which is why there is no second flag.
 */
export const ATTACHMENT_META: Record<
  AttachmentType,
  { label: string; icon: string; page: ((id: string) => string) | null }
> = {
  document: { label: 'Document', icon: 'i-lucide-file-text', page: (id) => `/documents/${id}` },
  // The same mark <BlockChart> puts on an embedded chart, so a chart looks like
  // a chart wherever it turns up. (It was the git-branch icon, which reads as a
  // diff — the one thing a chart is not.)
  chart: { label: 'Chart', icon: 'i-lucide-shapes', page: (id) => `/charts/${id}` },
  diff: { label: 'Diff', icon: 'i-lucide-git-pull-request', page: null },
}

/** The stable identity of a ref — `type:id`, the key every list and map uses. */
export function attachmentKey(a: Attachment): string {
  return `${a.type}:${a.id}`
}

export interface Project {
  id: string
  key: string
  title: string
  description: string
  mode: ProjectMode
  // GitHub link — '' when the project isn't wired to a repo. `repo` is a path
  // to a local clone (what jDiff takes as ?repo=); `integrationBranch` is the
  // empty branch this project's PRs target. See <ProjectGithub>.
  repo: string
  integrationBranch: string
  attachments: Attachment[]
  createdAt: string
  updatedAt: string
}

// The human leaves direction here before handing the ticket to an LLM; LLMs
// post progress notes and questions under their own name.
export interface TicketComment {
  id: string
  author: string
  body: string
  createdAt: string
}

export interface Ticket {
  id: string
  key: string
  title: string
  description: string
  acceptanceCriteria: string[]
  type: TicketType
  status: TicketStatus
  projectId: string | null
  assignee: string
  labels: string[]
  resolution: string
  blockedBy: string[]
  comments: TicketComment[]
  attachments: Attachment[]
  // When the ticket last became done; null while unfinished. Stamped by the
  // server on the status change, not by callers — see /finished.
  completedAt: string | null
  createdAt: string
  updatedAt: string
  // Derived flags the GET endpoints attach (never persisted). Optional so a
  // locally-constructed Ticket (e.g. form state) still satisfies the type.
  blocked?: boolean
  claimed?: boolean
  frontier?: boolean
}

// How long a ticket stays ringed after it moves under you.
export const CHANGE_HIGHLIGHT_MS = 10_000

export function useTracker() {
  const projects = useState<Project[]>('jticket-projects', () => [])
  const tickets = useState<Ticket[]>('jticket-tickets', () => [])
  // The whole shared document pool — the same list jExplain reads. jTicket no
  // longer keeps a record per document; a document belongs to a project by
  // being attached to it.
  const documents = useState<ExplainerMeta[]>('jticket-documents', () => [])
  // Ids of tickets that moved in the last live update (see useLiveTracker).
  // Cards ring themselves while an id is in here, so a change somebody *else*
  // made — an agent, another tab — is visible without re-reading the board.
  // Entries expire on their own; nothing has to clear them.
  const changed = useState<Record<string, number>>('jticket-changed', () => ({}))

  // Replaced wholesale rather than mutated: useState is backed by Nuxt's
  // *shallow*-reactive payload state, so writing a key into the object it holds
  // changes nothing on screen — only setting .value does.
  function markChanged(ids: string[]) {
    if (!ids.length) return
    const at = Date.now()
    const next = { ...changed.value }
    for (const id of ids) next[id] = at
    changed.value = next

    for (const id of ids) {
      // Keyed on `at` so a ticket that moves again mid-fade keeps the newer
      // highlight instead of having it cut short by the older timer.
      setTimeout(() => {
        if (changed.value[id] !== at) return
        const after = { ...changed.value }
        delete after[id]
        changed.value = after
      }, CHANGE_HIGHLIGHT_MS)
    }
  }

  async function refresh() {
    const [p, t, d] = await Promise.all([
      $fetch<Project[]>('/api/projects'),
      $fetch<Ticket[]>('/api/tickets'),
      // The shared pool can be unreachable without the board being broken.
      $fetch<ExplainerMeta[]>('/api/documents').catch(() => [] as ExplainerMeta[]),
    ])
    projects.value = p
    tickets.value = t
    documents.value = d
  }

  // ── Projects ──
  async function createProject(input: Partial<Project>) {
    await $fetch('/api/projects', { method: 'POST', body: input })
    await refresh()
  }
  async function updateProject(id: string, input: Partial<Project>) {
    await $fetch(`/api/projects/${id}`, { method: 'PATCH', body: input })
    await refresh()
  }
  async function deleteProject(id: string) {
    await $fetch(`/api/projects/${id}`, { method: 'DELETE' })
    await refresh()
  }

  // ── Tickets ──
  async function createTicket(input: Partial<Ticket>) {
    await $fetch('/api/tickets', { method: 'POST', body: input })
    await refresh()
  }
  async function updateTicket(id: string, input: Partial<Ticket>) {
    await $fetch(`/api/tickets/${id}`, { method: 'PATCH', body: input })
    await refresh()
  }
  async function deleteTicket(id: string) {
    await $fetch(`/api/tickets/${id}`, { method: 'DELETE' })
    await refresh()
  }
  async function addComment(ticketId: string, input: { author: string; body: string }) {
    await $fetch(`/api/tickets/${ticketId}/comments`, { method: 'POST', body: input })
    await refresh()
  }
  async function deleteComment(ticketId: string, commentId: string) {
    await $fetch(`/api/tickets/${ticketId}/comments/${commentId}`, { method: 'DELETE' })
    await refresh()
  }

  // Attachments are not mirrored into this state: <AttachmentsPanel> fetches
  // and refreshes a record's own list, because resolving a ref reads the pools
  // on every call and the board has no use for the result.

  return {
    projects,
    tickets,
    documents,
    changed,
    markChanged,
    refresh,
    createProject,
    updateProject,
    deleteProject,
    createTicket,
    updateTicket,
    deleteTicket,
    addComment,
    deleteComment,
  }
}

// ── Small view helpers ──
export const STATUS_META: Record<TicketStatus, { label: string; color: 'neutral' | 'info' | 'success' }> = {
  todo: { label: 'To Do', color: 'neutral' },
  in_progress: { label: 'In Progress', color: 'info' },
  done: { label: 'Done', color: 'success' },
}

export function isBlocked(ticket: Ticket, all: Ticket[]): boolean {
  return ticket.blockedBy.some((id) => {
    const dep = all.find((t) => t.id === id)
    return dep ? dep.status !== 'done' : false
  })
}

// The frontier: takeable edge of a map — open, unblocked, unclaimed.
export function isFrontier(ticket: Ticket, all: Ticket[]): boolean {
  return ticket.status === 'todo' && !ticket.assignee && !isBlocked(ticket, all)
}

// ── Wayfinder labels ──
export type WayfinderType = 'research' | 'prototype' | 'grilling' | 'task'
export const WAYFINDER_TYPES: WayfinderType[] = ['research', 'prototype', 'grilling', 'task']

export const WAYFINDER_TYPE_META: Record<WayfinderType, { label: string; icon: string; color: 'info' | 'warning' | 'success' | 'neutral' }> = {
  research: { label: 'Research', icon: 'i-lucide-book-open', color: 'info' },
  prototype: { label: 'Prototype', icon: 'i-lucide-flask-conical', color: 'warning' },
  grilling: { label: 'Grilling', icon: 'i-lucide-messages-square', color: 'success' },
  task: { label: 'Task', icon: 'i-lucide-wrench', color: 'neutral' },
}

// Pull the wayfinder sub-type out of a ticket's labels (first wayfinder:<type>).
export function wayfinderType(ticket: Pick<Ticket, 'labels'>): WayfinderType | null {
  for (const l of ticket.labels ?? []) {
    const m = /^wayfinder:(research|prototype|grilling|task)$/.exec(l)
    if (m) return m[1] as WayfinderType
  }
  return null
}

// ── Completion times ──
// Newest completion first; unstamped tickets sort last.
export function byCompletedAtDesc(a: Ticket, b: Ticket): number {
  return (b.completedAt ?? '').localeCompare(a.completedAt ?? '')
}

const DAY_FMT = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
const TIME_FMT = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' })

// 'Today' / 'Yesterday' / 'Monday 4 August 2026' — the heading a day's finished
// tickets sit under. `today` is passed in so callers control the clock (and so
// nothing renders a server-time heading that the client then disagrees with).
export function dayLabel(iso: string, today: Date): string {
  const d = new Date(iso)
  const days = Math.round((startOfDay(today).getTime() - startOfDay(d).getTime()) / 86_400_000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return DAY_FMT.format(d)
}

export function timeLabel(iso: string): string {
  return TIME_FMT.format(new Date(iso))
}

// "just now" / "20 minutes ago" / "3 days ago" — the at-a-glance recency on a row.
export function agoLabel(iso: string, now: Date): string {
  const mins = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60_000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`
  const weeks = Math.round(days / 7)
  if (weeks < 5) return `${weeks} week${weeks === 1 ? '' : 's'} ago`
  const months = Math.round(days / 30)
  return `${months} month${months === 1 ? '' : 's'} ago`
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}
