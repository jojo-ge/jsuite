// Bulk authoring endpoint for LLM skills (e.g. Matt Pocock's to-tickets).
// Accepts a whole breakdown at once and resolves blocked-by edges by ticket
// TITLE or KEY, so the caller never needs to know generated ids up front.
//
// Body shape:
// {
//   "epics":   [{ "title": "...", "description": "..." }],
//   "tickets": [{
//     "title": "...",
//     "description": "...",
//     "acceptanceCriteria": ["...", "..."],
//     "type": "AFK" | "HITL",
//     "epic": "<epic title or key>",          // optional
//     "blockedBy": ["<ticket title or key>"]   // optional
//   }]
// }
interface ImportProject {
  title: string
  description?: string
  mode?: ProjectMode // 'wayfinder' turns the whole project into a wayfinder effort
}
interface ImportEpic {
  title: string
  description?: string
  project?: string | null // project title or key
  labels?: string[] // e.g. ['wayfinder:map']
}
interface ImportTicket {
  title: string
  description?: string
  acceptanceCriteria?: string[]
  type?: TicketType
  status?: TicketStatus
  epic?: string | null
  assignee?: string
  labels?: string[]
  wayfinderType?: string // shorthand → adds a 'wayfinder:<type>' label
  resolution?: string
  blockedBy?: string[]
}

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    projects?: ImportProject[]
    epics?: ImportEpic[]
    tickets?: ImportTicket[]
  }>(event)
  const store = loadStore()
  const ts = now()

  const createdProjects: Project[] = []
  const createdEpics: Epic[] = []
  const createdTickets: Ticket[] = []

  // 1. Create projects.
  for (const p of body.projects ?? []) {
    if (!p?.title?.trim()) continue
    const project: Project = {
      id: newId('proj'),
      key: nextKey(store, 'project'),
      title: p.title.trim(),
      description: p.description?.trim() ?? '',
      mode: p.mode === 'wayfinder' ? 'wayfinder' : 'standard',
      createdAt: ts,
      updatedAt: ts,
    }
    store.projects.push(project)
    createdProjects.push(project)
  }

  const findProject = (ref?: string | null) =>
    ref ? store.projects.find((p) => p.id === ref || p.key === ref || p.title === ref) : undefined

  // 2. Create epics (referencing a project by title or key).
  for (const e of body.epics ?? []) {
    if (!e?.title?.trim()) continue
    const epic: Epic = {
      id: newId('epic'),
      key: nextKey(store, 'epic'),
      title: e.title.trim(),
      description: e.description?.trim() ?? '',
      projectId: findProject(e.project)?.id ?? null,
      labels: cleanLabels(e.labels),
      createdAt: ts,
      updatedAt: ts,
    }
    store.epics.push(epic)
    createdEpics.push(epic)
  }

  const findEpic = (ref?: string | null) =>
    ref ? store.epics.find((e) => e.id === ref || e.key === ref || e.title === ref) : undefined

  // 3. Create tickets (no edges yet — titles may reference not-yet-created tickets).
  const importPairs: Array<{ ticket: Ticket; src: ImportTicket }> = []
  for (const t of body.tickets ?? []) {
    if (!t?.title?.trim()) continue
    const ticket: Ticket = {
      id: newId('tick'),
      key: nextKey(store, 'ticket'),
      title: t.title.trim(),
      description: t.description?.trim() ?? '',
      acceptanceCriteria: (t.acceptanceCriteria ?? []).map((s) => String(s).trim()).filter(Boolean),
      type: t.type === 'HITL' ? 'HITL' : 'AFK',
      status: isStatus(t.status) ? t.status : 'todo',
      epicId: findEpic(t.epic)?.id ?? null,
      assignee: typeof t.assignee === 'string' ? t.assignee.trim() : '',
      labels: cleanLabels([...(t.labels ?? []), ...(t.wayfinderType ? [`wayfinder:${t.wayfinderType}`] : [])]),
      resolution: typeof t.resolution === 'string' ? t.resolution.trim() : '',
      blockedBy: [],
      comments: [],
      createdAt: ts,
      updatedAt: ts,
    }
    store.tickets.push(ticket)
    createdTickets.push(ticket)
    importPairs.push({ ticket, src: t })
  }

  // 4. Resolve blocked-by edges now that every ticket exists (by title or key).
  const byRef = (ref: string) =>
    store.tickets.find((x) => x.id === ref || x.key === ref || x.title === ref)
  for (const { ticket, src } of importPairs) {
    const edges = new Set<string>()
    for (const ref of src.blockedBy ?? []) {
      const dep = byRef(String(ref).trim())
      if (dep && dep.id !== ticket.id) edges.add(dep.id)
    }
    ticket.blockedBy = [...edges]
  }

  saveStore(store)
  setResponseStatus(event, 201)
  return { projects: createdProjects, epics: createdEpics, tickets: createdTickets }
})
