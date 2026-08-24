export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const body = await readBody(event)
  if (typeof body?.data !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'data (string) is required' })
  }
  const manager = usePeerManager()
  if (!manager.get(id)) throw createError({ statusCode: 404, statusMessage: 'peer not found' })
  try {
    manager.send(id, body.data)
  } catch (error) {
    throw createError({ statusCode: 409, statusMessage: (error as Error).message })
  }
  return { ok: true }
})
