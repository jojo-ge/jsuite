export default defineEventHandler(async (event) => {
  const key = String(getRouterParam(event, 'key'))
  const kata = await readKata(key)
  if (!kata) throw createError({ statusCode: 404, message: `No such kata: ${key}` })
  // Charts the brief/answer materialised stay in the shared pool.
  await deleteKata(key)
  return { ok: true }
})
