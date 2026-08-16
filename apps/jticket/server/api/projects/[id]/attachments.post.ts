// Link an artifact to a project: { type: 'document'|'chart'|'diff', id }.
// Same contract as the ticket endpoint — idempotent, and the artifact needn't
// exist yet.
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const body = await readBody<{ type?: unknown; id?: unknown }>(event)
  const store = loadStore()
  const project = store.projects.find((p) => p.id === id || p.key === id)
  if (!project) throw createError({ statusCode: 404, statusMessage: 'project not found' })

  const [attachment] = cleanAttachments([body])
  if (!attachment) {
    throw createError({
      statusCode: 400,
      statusMessage: 'need { type: document|chart|diff, id }',
      message:
        'id is a pool key for a document or chart, and a PR number or branch/<name> for a diff',
    })
  }

  project.attachments = addAttachment(project.attachments, attachment)
  project.updatedAt = now()
  saveStore(store)
  setResponseStatus(event, 201)
  return project.attachments
})
