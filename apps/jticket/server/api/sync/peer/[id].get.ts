export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id')!
  const status = usePeerManager().get(id)
  if (!status) throw createError({ statusCode: 404, statusMessage: 'peer not found' })
  return status
})
