export default defineEventHandler((event) => {
  const q = getQuery(event)
  const store = loadStore()
  const all = store.tickets
  let tickets = all
  if (q.epicId) {
    // Accept an epic id or key.
    const epic = store.epics.find((e) => e.id === q.epicId || e.key === q.epicId)
    const epicId = epic?.id ?? q.epicId
    tickets = tickets.filter((t) => t.epicId === epicId)
  }
  if (q.status) tickets = tickets.filter((t) => t.status === q.status)
  if (q.assignee) tickets = tickets.filter((t) => t.assignee === q.assignee)
  if (q.label) tickets = tickets.filter((t) => t.labels.includes(String(q.label)))
  // ?frontier=true → the takeable edge: open, unblocked, unclaimed; key-ordered.
  if (q.frontier === 'true' || q.frontier === '1') {
    tickets = tickets.filter((t) => ticketIsFrontier(t, all)).sort(byKeyNumber)
  }
  return tickets.map((t) => withDerived(t, all))
})
