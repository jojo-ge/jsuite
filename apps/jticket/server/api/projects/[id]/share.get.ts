// The project's share, with derived status and (while active) the capability
// link — what the project page's share panel renders. { share: null } when the
// project has never been shared.
export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id')
  const store = loadStore()
  const project = findByRef(store.projects, id)
  if (!project) throw createError({ statusCode: 404, statusMessage: 'project not found' })

  const share = findShare(store, project.id)
  return { share: share ? shareView(share, getRequestURL(event).origin) : null }
})
