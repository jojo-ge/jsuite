export default defineEventHandler(async (event) => {
  const body = await readBody<{ workspaceId?: string; ticket?: string; force?: boolean }>(event)
  const workspaceId = (body?.workspaceId ?? '').trim()
  const ticket = (body?.ticket ?? '').trim()
  if (!workspaceId || !ticket) throw createError({ statusCode: 400, message: 'workspaceId and ticket are required' })
  const r = await dispatchTicket(workspaceId, ticket, !!body?.force)
  setResponseStatus(event, 201)
  return r
})
