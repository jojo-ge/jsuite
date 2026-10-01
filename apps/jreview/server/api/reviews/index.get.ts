/**
 * The reviews, newest first (meta). `?project=PROJ-n` narrows to one jTicket
 * project's — the ones its Review tab started, and its auto loop's consensus
 * reviews.
 */
export default defineEventHandler(async (event) => {
  const project = String(getQuery(event).project ?? '').trim()
  const reviews = await listReviews()
  return (project ? reviews.filter((r) => r.project === project || r.consensus?.projectKey === project) : reviews).map(reviewMeta)
})
