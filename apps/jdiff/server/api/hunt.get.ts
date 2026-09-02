// The saved hunt manifest for a target — every suspected bug and
// vulnerability the hunt session found — joined with which issue tours have
// landed so far. Read by the UI's hunt panel and by dispatched /jdiff-hunt
// walker sessions looking up their own issue's details.
export default defineEventHandler((event) => {
  const repoPath = resolveRepoDir(String(getQuery(event).repo ?? ''))
  const target = resolveTarget(event)
  const saved = loadHunt(repoPath, target.storeKey)
  if (!saved) return null
  const tours: Record<string, { createdAt: string }> = {}
  for (const v of loadTourVariants(repoPath, target.storeKey)) {
    if (v.variant.startsWith('issue:')) {
      tours[v.variant.slice('issue:'.length)] = { createdAt: v.createdAt }
    }
  }
  return { ...saved, tours }
})
