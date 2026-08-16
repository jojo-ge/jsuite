// The project's own artifacts, resolved — same contract as a ticket's, with
// the project's repo as the context diff refs resolve against.
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const store = loadStore()
  const project = store.projects.find((p) => p.id === id || p.key === id)
  if (!project) throw createError({ statusCode: 404, statusMessage: 'project not found' })
  return await resolveAttachments(project.attachments, { repo: project.repo })
})
