// List local PRs (?projectId= &repo= &ticket= &status=), newest first. Rows carry the
// ticket key/title and a jDiff link; commit details are on GET /api/prs/:id
// (and inline on the project's /github payload), not here — this list stays a
// pure store read, no git.
export default defineEventHandler((event) => {
  const q = getQuery(event)
  const store = loadStore()
  let prs = store.prs

  if (q.projectId) {
    const project = store.projects.find((p) => p.id === q.projectId || p.key === q.projectId)
    const projectId = project?.id ?? q.projectId
    prs = prs.filter((pr) => pr.projectId === projectId)
  }
  // ?repo= → PRs in that codebase's projects (path, '~/…', or known slug).
  if (q.repo) {
    const ids = projectIdsForRepo(store, resolveRepoParam(store, q.repo))
    prs = prs.filter((pr) => ids.has(pr.projectId))
  }
  if (q.ticket || q.ticketId) {
    const ref = String(q.ticket ?? q.ticketId)
    const ticket = store.tickets.find((t) => t.id === ref || t.key === ref)
    prs = prs.filter((pr) => pr.ticketId === (ticket?.id ?? ref))
  }
  if (q.status) prs = prs.filter((pr) => pr.status === q.status)

  const repoOf = new Map(store.projects.map((p) => [p.id, p.repo.trim() ? expandHome(p.repo) : null]))
  return [...prs]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((pr) => withPrDerived(store, pr, repoOf.get(pr.projectId) ?? null))
})
