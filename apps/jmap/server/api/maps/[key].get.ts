export default defineEventHandler(async (event) => {
  const key = String(getRouterParam(event, 'key'))
  const map = await readMap(key)
  if (!map) throw createError({ statusCode: 404, message: `No such map: ${key}` })
  return map
})
