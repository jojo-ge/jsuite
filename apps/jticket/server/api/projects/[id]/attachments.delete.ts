// Unlink an artifact from a project: ?type=&id=. The artifact itself stays in
// its pool — jTicket only ever owned the link.
export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id')
  const { type, id: artifactId } = getQuery(event)
  const store = loadStore()
  const project = store.projects.find((p) => p.id === id || p.key === id)
  if (!project) throw createError({ statusCode: 404, statusMessage: 'project not found' })
  if (!isAttachmentType(type)) {
    throw createError({ statusCode: 400, statusMessage: 'need ?type=document|chart|diff&id=' })
  }

  project.attachments = removeAttachment(project.attachments, { type, id: String(artifactId ?? '') })
  project.updatedAt = now()
  saveStore(store)
  return project.attachments
})
