// The saved chains manifest for a target, joined with which chain tours have
// landed so far — read by the UI's chains panel and by dispatched
// /jdiff-chains walker sessions looking up their own chain's details.
export default defineEventHandler((event) => {
  const repoPath = resolveRepoDir(String(getQuery(event).repo ?? ''))
  const target = resolveTarget(event)
  const saved = loadChains(repoPath, target.storeKey)
  if (!saved) return null
  const tours: Record<string, { createdAt: string }> = {}
  for (const v of loadTourVariants(repoPath, target.storeKey)) {
    if (v.variant.startsWith('chain:')) {
      tours[v.variant.slice('chain:'.length)] = { createdAt: v.createdAt }
    }
  }
  return { ...saved, tours }
})
