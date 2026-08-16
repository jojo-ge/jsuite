export default defineEventHandler((event) => {
  const repoPath = resolveRepoDir(String(getQuery(event).repo ?? ''))
  const target = resolveTarget(event)
  return loadRiskMap(repoPath, target.storeKey)
})
