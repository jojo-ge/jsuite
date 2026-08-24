// List projects (?repo= narrows to one codebase — a path, '~/…', or a known
// slug). Every row carries a derived `repoPath` (the repo field resolved) so
// clients can group by codebase without expanding '~' themselves. Never
// persisted — computed per request, like withDerived on tickets.
export default defineEventHandler((event) => {
  const q = getQuery(event)
  const store = loadStore()
  let projects = store.projects
  if (q.repo) {
    const path = resolveRepoParam(store, q.repo)
    projects = projects.filter((p) => projectRepoPath(p) === path)
  }
  return projects.map((p) => ({ ...p, repoPath: projectRepoPath(p) }))
})
