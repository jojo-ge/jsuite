// Client-side mirror of the server types (see server/utils/store.ts).
export type TicketType = 'AFK' | 'HITL'
export type TicketStatus = 'todo' | 'in_progress' | 'done' | 'merged'
export type DocStatus = 'draft' | 'ready'
export type LocalPrStatus = 'open' | 'conflicted' | 'merged' | 'closed'
export type ProjectMode = 'standard' | 'wayfinder' | 'jmap'

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
  // The ticket's local work branch ('' until cut) — a local PR's default head.
  branch: string
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

// A local pull request (see server/utils/store.ts) as GET /api/prs returns it:
// the record plus the derived ticketKey/ticketTitle/jdiffUrl.
export interface LocalPr {
  id: string
  key: string
  title: string
  description: string
  ticketId: string
  projectId: string
  headBranch: string
  baseBranch: string
  status: LocalPrStatus
  conflictFiles: string[]
  mergeCommit: string
  mergedAt: string | null
  createdAt: string
  updatedAt: string
  ticketKey?: string | null
  ticketTitle?: string | null
  jdiffUrl?: string | null
}

// A tracker record wrapping a document in the shared @jsuite/documents pool —
// the content (blocks, glossary) lives in the shared document, which jExplain
// lists and renders too.
export interface Doc {
  id: string
  key: string
  title: string
  documentKey: string
  projectId: string | null
  labels: string[]
  status: DocStatus
  createdAt: string
  updatedAt: string
}

// How long a ticket stays ringed after it moves under you.
export const CHANGE_HIGHLIGHT_MS = 10_000

export function useTracker() {
  const projects = useState<Project[]>('jticket-projects', () => [])
  const tickets = useState<Ticket[]>('jticket-tickets', () => [])
  const docs = useState<Doc[]>('jticket-docs', () => [])
  const prs = useState<LocalPr[]>('jticket-prs', () => [])
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
    const [p, t, d, pr] = await Promise.all([
      $fetch<Project[]>('/api/projects'),
      $fetch<Ticket[]>('/api/tickets'),
      $fetch<Doc[]>('/api/docs'),
      $fetch<LocalPr[]>('/api/prs'),
    ])
    projects.value = p
    tickets.value = t
    docs.value = d
    prs.value = pr
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

  // ── Docs ──
  async function createDoc(input: Partial<Doc>): Promise<Doc> {
    const doc = await $fetch<Doc>('/api/docs', { method: 'POST', body: input })
    await refresh()
    return doc
  }
  async function updateDoc(id: string, input: Partial<Doc>) {
    await $fetch(`/api/docs/${id}`, { method: 'PATCH', body: input })
    await refresh()
  }
  async function deleteDoc(id: string) {
    await $fetch(`/api/docs/${id}`, { method: 'DELETE' })
    await refresh()
  }

  return {
    projects,
    tickets,
    docs,
    prs,
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
    createDoc,
    updateDoc,
    deleteDoc,
  }
}

// ── Small view helpers ──
export const STATUS_META: Record<TicketStatus, { label: string; color: 'neutral' | 'info' | 'success' | 'secondary' }> = {
  todo: { label: 'To Do', color: 'neutral' },
  in_progress: { label: 'In Progress', color: 'info' },
  done: { label: 'Done', color: 'success' },
  merged: { label: 'Merged', color: 'secondary' },
}

// 'done' and 'merged' both count as finished — the client twin of the server's
// isFinishedStatus, used everywhere that used to ask `status === 'done'`.
export function isFinished(status: TicketStatus): boolean {
  return status === 'done' || status === 'merged'
}

// ── The merge sweep ──
// A project's mergeable queue: open AND conflicted local PRs (merging the
// conflicted ones is exactly what the sweep is for), oldest first — the landing
// order that minimises rebase churn.
export function mergeQueueOf<T extends Pick<LocalPr, 'projectId' | 'status' | 'key'>>(prs: T[], projectId: string): T[] {
  const n = (k: string) => Number(k.split('-').pop()) || 0
  return prs
    .filter((pr) => pr.projectId === projectId && (pr.status === 'open' || pr.status === 'conflicted'))
    .sort((a, b) => n(a.key) - n(b.key))
}

// The hand-off that lands the queue: one prompt an agent can follow to merge
// every PR, rebasing through conflicts. Used verbatim by the copy buttons and
// the herdr dispatch on /next and the project page.
export function mergeSweepPrompt(
  project: Pick<Project, 'key' | 'repo' | 'integrationBranch'>,
  prKeys: string[],
): string {
  return [
    `Merge ${project.key}'s open local jTicket PRs into its integration branch ${project.integrationBranch}, oldest first: ${prKeys.join(', ')}.`,
    'For each one: POST http://localhost:43000/api/prs/<key>/merge.',
    `On a 409 conflict: in the repo at ${project.repo}, rebase that PR's head branch onto ${project.integrationBranch}, resolve the conflicts preserving both sides' intent, then POST the merge again.`,
    'Everything stays local — do not push or touch GitHub.',
  ].join(' ')
}

export const DOC_STATUS_META: Record<DocStatus, { label: string; color: 'neutral' | 'success' }> = {
  draft: { label: 'Draft', color: 'neutral' },
  ready: { label: 'Ready', color: 'success' },
}

export function isBlocked(ticket: Ticket, all: Ticket[]): boolean {
  return ticket.blockedBy.some((id) => {
    const dep = all.find((t) => t.id === id)
    return dep ? !isFinished(dep.status) : false
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
