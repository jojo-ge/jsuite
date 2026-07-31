export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id')
  const store = loadStore()
  const doc = store.docs.find((d) => d.id === id || d.key === id)
  if (!doc) throw createError({ statusCode: 404, statusMessage: 'doc not found' })
  return doc
})
