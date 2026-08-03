// Client-side mirror of the server types (see server/utils/store.ts).
export type TicketType = 'AFK' | 'HITL'
export type TicketStatus = 'todo' | 'in_progress' | 'done'
export type DocStatus = 'draft' | 'ready'
export type ProjectMode = 'standard' | 'wayfinder'

export interface Project {
  id: string
  key: string
  title: string
  description: string
  mode: ProjectMode
  createdAt: string
  updatedAt: string
}

export interface Epic {
  id: string
  key: string
  title: string
  description: string
  projectId: string | null
  labels: string[]
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
  epicId: string | null
  assignee: string
  labels: string[]
  resolution: string
  blockedBy: string[]
  comments: TicketComment[]
  createdAt: string
  updatedAt: string
  // Derived flags the GET endpoints attach (never persisted). Optional so a
  // locally-constructed Ticket (e.g. form state) still satisfies the type.
  blocked?: boolean
  claimed?: boolean
  frontier?: boolean
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

export function useTracker() {
  const projects = useState<Project[]>('jticket-projects', () => [])
  const epics = useState<Epic[]>('jticket-epics', () => [])
  const tickets = useState<Ticket[]>('jticket-tickets', () => [])
  const docs = useState<Doc[]>('jticket-docs', () => [])

  async function refresh() {
    const [p, e, t, d] = await Promise.all([
      $fetch<Project[]>('/api/projects'),
      $fetch<Epic[]>('/api/epics'),
      $fetch<Ticket[]>('/api/tickets'),
      $fetch<Doc[]>('/api/docs'),
    ])
    projects.value = p
    epics.value = e
    tickets.value = t
    docs.value = d
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

  // ── Epics ──
  async function createEpic(input: Partial<Epic>) {
    await $fetch('/api/epics', { method: 'POST', body: input })
    await refresh()
  }
  async function updateEpic(id: string, input: Partial<Epic>) {
    await $fetch(`/api/epics/${id}`, { method: 'PATCH', body: input })
    await refresh()
  }
  async function deleteEpic(id: string) {
    await $fetch(`/api/epics/${id}`, { method: 'DELETE' })
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
    epics,
    tickets,
    docs,
    refresh,
    createProject,
    updateProject,
    deleteProject,
    createEpic,
    updateEpic,
    deleteEpic,
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
export const STATUS_META: Record<TicketStatus, { label: string; color: 'neutral' | 'info' | 'success' }> = {
  todo: { label: 'To Do', color: 'neutral' },
  in_progress: { label: 'In Progress', color: 'info' },
  done: { label: 'Done', color: 'success' },
}

export const DOC_STATUS_META: Record<DocStatus, { label: string; color: 'neutral' | 'success' }> = {
  draft: { label: 'Draft', color: 'neutral' },
  ready: { label: 'Ready', color: 'success' },
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
export const WAYFINDER_MAP_LABEL = 'wayfinder:map'
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

export function isMapEpic(epic: Pick<Epic, 'labels'>): boolean {
  return (epic.labels ?? []).includes(WAYFINDER_MAP_LABEL)
}
