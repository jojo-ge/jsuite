// Every stored graph (app/utils/graphs.ts), newest first — ?repo=<codebase
// path> keeps the codebase's own. Each node carries its project, progress and
// state; slice sizes and Move on records are on GET /api/graphs/:id only.
export default defineEventHandler((event) => {
  const repo = String(getQuery(event).repo ?? '').trim()
  const store = loadStore()
  const path = repo ? resolveRepoDir(repo) : ''
  return store.graphs
    .filter((g) => !path || resolveRepoDir(g.repo) === path)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((g) => graphView(store, g))
})
