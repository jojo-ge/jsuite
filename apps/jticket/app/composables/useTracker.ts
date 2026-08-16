// The board's client half: the reactive state every screen reads, the calls
// that move it, and the view meta (labels, icons, colours, date formatting)
// that only a screen cares about. The records themselves are declared in
// shared/types/tracker.ts and the rules read off them in shared/utils/tracker.ts
// (auto-imported) — both sides of the app share those.

import type { ExplainerMeta } from '@jsuite/documents/types'
import type { AttachmentType, Project, Ticket, TicketStatus } from '#shared/types/tracker'

/**
 * Everything that differs by artifact type, in one place — so a new type is a
 * row here rather than a fresh `if (a.type === …)` in every component that
 * touches attachments.
 *
 * There is no `page` builder here any more. Every artifact now has a full view
 * *inside* jTicket — documents and charts through @jsuite/documents and
 * @jsuite/charting, and, since TICK-142, a diff through @jsuite/diff — and a
 * diff's page needs the repo as well as the id, which only the server knows.
 * So the one place a full view is addressed from is `ResolvedAttachment.url`,
 * which the server resolves per ref, and all that is left to vary by type here
 * is how a row is labelled. What *renders* an opened artifact stays in
 * <AttachmentsPanel>: three embeds that share no shape worth tabulating.
 */
export const ATTACHMENT_META: Record<AttachmentType, { label: string; icon: string }> = {
  document: { label: 'Document', icon: 'i-lucide-file-text' },
  // The same mark <BlockChart> puts on an embedded chart, so a chart looks like
  // a chart wherever it turns up. (It was the git-branch icon, which reads as a
  // diff — the one thing a chart is not.)
  chart: { label: 'Chart', icon: 'i-lucide-shapes' },
  diff: { label: 'Diff', icon: 'i-lucide-git-pull-request' },
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

  // No <T> on the tracker's own two calls: Nuxt types $fetch from the route
  // handler, so `p` and `t` are what /api/projects and /api/tickets actually
  // return, and assigning them into state is a check rather than an assertion.
  // A handler that stopped returning Projects would fail here, at build time.
  async function refresh() {
    const [p, t, d] = await Promise.all([
      $fetch('/api/projects'),
      $fetch('/api/tickets'),
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
