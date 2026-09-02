import type { TourVariant } from '../../app/utils/tour'

// One saved tour as a standalone, shareable HTML walkthrough — code on the
// left, the guide's note on the right, in reading order. Downloaded rather
// than rendered in place, so the file can be handed to a developer who has
// neither jDiff nor the repo.
export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const repoPath = resolveRepoDir(String(query.repo ?? ''))
  const target = resolveTarget(event)
  const variant = parseVariantParam(query.variant)

  const saved = loadTour(repoPath, target.storeKey, variant)
  if (!saved) throw createError({ statusCode: 404, message: 'no tour saved for that variant' })

  const topic = topicFor(repoPath, target.storeKey, variant)
  const prepared = await prepareTarget(target, repoPath)
  const { title } = await targetMeta(prepared, repoPath)

  const html = await buildTourExport({
    repoPath,
    target,
    variant,
    tour: saved.tour,
    createdAt: saved.createdAt,
    title,
    topic,
  })

  setHeader(event, 'content-type', 'text/html; charset=utf-8')
  setHeader(event, 'content-disposition', `attachment; filename="${exportFilename(target, variant)}"`)
  return html
})

// A chain or issue tour is *about* one manifest entry — its title and summary
// head the exported page.
function topicFor(repoPath: string, storeKey: string, variant: TourVariant) {
  if (variant.startsWith('chain:')) {
    const id = variant.slice('chain:'.length)
    const found = loadChains(repoPath, storeKey)?.chains.find((c) => c.id === id)
    return found ? { title: found.title, summary: found.summary } : null
  }
  if (variant.startsWith('issue:')) {
    const id = variant.slice('issue:'.length)
    const found = loadHunt(repoPath, storeKey)?.issues.find((i) => i.id === id)
    return found ? { title: found.title, summary: found.summary } : null
  }
  return null
}
