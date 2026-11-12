export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id')
  const store = loadStore()
  const doc = findByRef(store.docs, id)
  if (!doc) throw createError({ statusCode: 404, statusMessage: 'doc not found' })
  return doc
})
