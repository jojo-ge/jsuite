// The Review tab's list: this project's reviews, newest first — the ones the
// tab started and the auto loop's consensus reviews. The review engine runs
// in-process, so the list is always available (`available` stays for the tab).
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const store = loadStore()
  const project = store.projects.find((p) => p.id === id || p.key === id)
  if (!project) throw createError({ statusCode: 404, statusMessage: 'project not found' })

  const reviews = (await listReviews()).filter((r) => reviewBelongsTo(r, project.key)).map(reviewMeta)
  return { available: true, reviews }
})
