export default defineEventHandler((event) => {
  const q = getQuery(event)
  const store = loadStore()
  const all = store.tickets
  let tickets = all
  if (q.projectId) {
    // Accept a project id or key.
    const project = store.projects.find((p) => p.id === q.projectId || p.key === q.projectId)
    const projectId = project?.id ?? q.projectId
    tickets = tickets.filter((t) => t.projectId === projectId)
  }
  // ?repo= → tickets in that codebase's projects (path, '~/…', or known slug).
  // Backlog tickets (projectId null) belong to no codebase, so they're excluded.
  if (q.repo) {
    const ids = projectIdsForRepo(store, resolveRepoParam(store, q.repo))
    tickets = tickets.filter((t) => t.projectId && ids.has(t.projectId))
  }
  if (q.status) tickets = tickets.filter((t) => t.status === q.status)
  if (q.assignee) tickets = tickets.filter((t) => t.assignee === q.assignee)
  if (q.label) tickets = tickets.filter((t) => t.labels.includes(String(q.label)))
  // ?frontier=true → the takeable edge: open, unblocked, unclaimed, ours;
  // key-ordered. The share says which tickets are the peer's on a shared project.
  if (q.frontier === 'true' || q.frontier === '1') {
    tickets = tickets.filter((t) => ticketIsFrontier(t, all, shareForTicket(store, t))).sort(byKeyNumber)
  }
  // ?finished=true → what just landed: done + merged tickets, newest completion first.
  if (q.finished === 'true' || q.finished === '1') {
    tickets = tickets.filter((t) => isFinishedStatus(t.status) && t.completedAt).sort(byCompletedAtDesc)
  }
  // ?since=<ISO> → completed at or after that instant. It reads completedAt, so
  // it drops unfinished tickets whether or not finished=true came with it —
  // "since" only ever means "finished since".
  if (q.since) {
    const since = String(q.since)
    tickets = tickets.filter((t) => !!t.completedAt && t.completedAt >= since)
  }
  return tickets.map((t) => withDerived(t, all, shareForTicket(store, t)))
})
