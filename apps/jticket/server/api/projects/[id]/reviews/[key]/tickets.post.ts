// Add triaged findings to THIS project as tickets — the Review tab's button.
// Body: { findingIds: string[] }. jReview does the filing (one AFK bug ticket
// per finding, through jTicket's own import) and records each finding's ticket
// key, so a finding can't be added twice and the rest can be added later.
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const body = (await readBody<{ findingIds?: string[] }>(event)) ?? {}
  const store = loadStore()
  const project = store.projects.find((p) => p.id === id || p.key === id)
  if (!project) throw createError({ statusCode: 404, statusMessage: 'project not found' })
  if (!Array.isArray(body.findingIds) || !body.findingIds.length) {
    throw createError({ statusCode: 400, statusMessage: 'pick at least one finding' })
  }

  const review = await projectReview(project.key, String(getRouterParam(event, 'key')))
  if (review.consensus) {
    throw createError({ statusCode: 409, statusMessage: 'the auto loop files a consensus review\'s tickets itself' })
  }
  // Long: jReview calls back into this server to create the tickets.
  return jreviewFetch<{ projectKey: string; ticketKeys: string[]; added: string[] }>(
    `/api/reviews/${encodeURIComponent(review.key)}/tickets`,
    { method: 'POST', timeout: 30_000, body: { findingIds: body.findingIds.map(String), projectKey: project.key } },
  )
})
