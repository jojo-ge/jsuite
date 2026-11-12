// Post a review's finding tickets to its GitHub PR — the Review tab's Post to
// PR button, on the review engine. Body: { ticketKeys: string[], body: string }
// — the finding tickets picked (a finding is posted through its ticket) and
// the summary. It posts ONE pull-request review with your gh auth, as you,
// with event COMMENT — always; nothing here can approve or request changes.
// A ticket whose file and line are a line the PR changes goes inline, the rest
// in the body; "posted" is stamped on each ticket.
// Returns { url, inline, posted, ticketKeys, review }.
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const body = (await readBody<{ ticketKeys?: string[]; findingIds?: string[]; body?: string }>(event)) ?? {}
  const store = loadStore()
  const project = findByRef(store.projects, id)
  if (!project) throw createError({ statusCode: 404, statusMessage: 'project not found' })
  const review = await projectReview(project.key, String(getRouterParam(event, 'key')))
  return postReviewToPr(review.key, {
    ticketKeys: Array.isArray(body.ticketKeys) ? body.ticketKeys.map(String) : [],
    // Passed through so the old body shape is refused, not posted without its picks.
    findingIds: body.findingIds,
    body: typeof body.body === 'string' ? body.body : '',
  })
})
