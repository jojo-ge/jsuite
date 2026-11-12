// One of this project's reviews, whole — the Review tab polls it while the
// reviewers and triager work.
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const store = loadStore()
  const project = findByRef(store.projects, id)
  if (!project) throw createError({ statusCode: 404, statusMessage: 'project not found' })
  return projectReview(project.key, String(getRouterParam(event, 'key')))
})
