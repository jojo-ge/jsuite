// One of this project's reviews, whole — the Review tab polls it while the
// reviewers and triager work.
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const store = loadStore()
  const project = store.projects.find((p) => p.id === id || p.key === id)
  if (!project) throw createError({ statusCode: 404, statusMessage: 'project not found' })
  return projectReview(project.key, String(getRouterParam(event, 'key')))
})
