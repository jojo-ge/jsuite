import type { TourVariant } from '../../app/utils/tour'

// One saved tour for a target — ?variant= picks which ('overview' when
// absent, 'detail', or 'chain:<slug>'); null when that variant has no tour.
export default defineEventHandler((event) => {
  const query = getQuery(event)
  const repoPath = resolveRepoDir(String(query.repo ?? ''))
  const target = resolveTarget(event)
  return loadTour(repoPath, target.storeKey, variantParam(query.variant))
})

function variantParam(raw: unknown): TourVariant {
  if (raw === undefined || raw === 'overview') return 'overview'
  if (raw === 'detail') return 'detail'
  if (typeof raw === 'string' && raw.startsWith('chain:') && CHAIN_SLUG.test(raw.slice('chain:'.length))) {
    return raw as TourVariant
  }
  throw createError({ statusCode: 400, message: 'bad variant' })
}
