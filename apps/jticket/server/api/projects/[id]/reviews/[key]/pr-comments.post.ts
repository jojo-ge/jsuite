// Post a review's findings to its GitHub PR — the Review tab's Post to PR
// button, on the review engine. Body: { findingIds: string[], body: string }.
// It posts ONE pull-request review with your gh auth, as you, with event
// COMMENT — always; nothing here can approve or request changes. Findings on a
// changed line go inline, the rest in the body.
// Returns { url, inline, posted, review }.
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const body = (await readBody<{ findingIds?: string[]; body?: string }>(event)) ?? {}
  const store = loadStore()
  const project = store.projects.find((p) => p.id === id || p.key === id)
  if (!project) throw createError({ statusCode: 404, statusMessage: 'project not found' })
  const review = await projectReview(project.key, String(getRouterParam(event, 'key')))
  return postReviewToPr(review.key, {
    findingIds: Array.isArray(body.findingIds) ? body.findingIds.map(String) : [],
    body: typeof body.body === 'string' ? body.body : '',
  })
})
