// The Review tab's list: this project's jReview reviews, newest first — the
// ones the tab started and the auto loop's consensus reviews. jReview being
// down answers { available: false } so the tab can say so instead of erroring.
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const store = loadStore()
  const project = store.projects.find((p) => p.id === id || p.key === id)
  if (!project) throw createError({ statusCode: 404, statusMessage: 'project not found' })

  try {
    const reviews = await jreviewFetch<unknown[]>(`/api/reviews?project=${encodeURIComponent(project.key)}`)
    return { available: true, reviews }
  } catch (err: any) {
    return { available: false, reviews: [], error: String(err?.message ?? err) }
  }
})
