// One saved tour for a target — ?variant= picks which ('overview' when
// absent, 'detail', or 'chain:<slug>'); null when that variant has no tour.
export default defineEventHandler((event) => {
  const query = getQuery(event)
  const repoPath = resolveRepoDir(String(query.repo ?? ''))
  const target = resolveTarget(event)
  return loadTour(repoPath, target.storeKey, parseVariantParam(query.variant))
})
