/**
 * The reviews, newest first (meta). `?project=PROJ-n` narrows to one jTicket
 * project's — the ones its Review tab started, and its auto loop's consensus
 * reviews. `?orphaned=1` narrows to the ones no project's Review tab shows:
 * they belong to no project, or to one that has been deleted.
 */
export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const project = String(query.project ?? '').trim()
  let reviews = await listReviews()
  if (project) reviews = reviews.filter((r) => reviewBelongsTo(r, project))
  if (query.orphaned) {
    const live = new Set(loadStore().projects.map((p) => p.key))
    reviews = reviews.filter((r) => reviewIsOrphaned(r, live))
  }
  return reviews.map(reviewMeta)
})
