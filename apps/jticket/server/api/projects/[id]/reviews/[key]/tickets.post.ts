// Add a triage review's findings to THIS project as tickets — the Review
// tab's button. Body: { findingIds: string[] }. The review engine does the
// filing (one AFK bug ticket per finding) and records each finding's ticket
// key, so a finding can't be added twice and the rest can be added later.
// Not for an agreement review (a PR review project's): its findings are filed
// as record-only tickets when they are handed back, with no press.
// A review that predates projects and belongs to none can be filed here too:
// the room's project picker sends it, and that makes it this project's.
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const body = (await readBody<{ findingIds?: string[] }>(event)) ?? {}
  const store = loadStore()
  const project = findByRef(store.projects, id)
  if (!project) throw createError({ statusCode: 404, statusMessage: 'project not found' })
  if (!Array.isArray(body.findingIds) || !body.findingIds.length) {
    throw createError({ statusCode: 400, statusMessage: 'pick at least one finding' })
  }

  const review = await projectOrHomelessReview(project.key, String(getRouterParam(event, 'key')))
  if (review.consensus) {
    throw createError({ statusCode: 409, statusMessage: 'the auto loop files a consensus review\'s tickets itself' })
  }
  if (review.agreement) {
    throw createError({ statusCode: 409, statusMessage: `an agreement review's findings are already tickets on ${project.key} — nothing to add by hand` })
  }
  return fileReviewTickets(review.key, { findingIds: body.findingIds.map(String), projectKey: project.key })
})
