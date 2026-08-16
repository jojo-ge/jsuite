// Link an artifact to a ticket: { type: 'document'|'chart'|'diff', id }.
// Idempotent — attaching the same artifact twice leaves one ref. The artifact
// doesn't have to exist yet; a ref that points at nothing reads as missing.
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const body = await readBody<{ type?: unknown; id?: unknown }>(event)
  const store = loadStore()
  const ticket = store.tickets.find((t) => t.id === id || t.key === id)
  if (!ticket) throw createError({ statusCode: 404, statusMessage: 'ticket not found' })

  const [attachment] = cleanAttachments([body])
  if (!attachment) {
    throw createError({
      statusCode: 400,
      statusMessage: 'need { type: document|chart|diff, id }',
      message:
        'id is a pool key for a document or chart, and a PR number or branch/<name> for a diff',
    })
  }

  ticket.attachments = addAttachment(ticket.attachments, attachment)
  ticket.updatedAt = now()
  saveStore(store)
  setResponseStatus(event, 201)
  return ticket.attachments
})
