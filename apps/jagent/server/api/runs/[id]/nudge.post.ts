export default defineEventHandler(async (event) => {
  const body = await readBody<{ message?: string }>(event)
  const message = (body?.message ?? '').trim()
  if (!message) throw createError({ statusCode: 400, message: 'message is required' })
  return nudgeRun(getRouterParam(event, 'id')!, message)
})
