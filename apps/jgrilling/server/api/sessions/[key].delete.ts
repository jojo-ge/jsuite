export default defineEventHandler(async (event) => {
  const key = String(getRouterParam(event, 'key'))
  const session = await readGrill(key)
  if (!session) throw createError({ statusCode: 404, message: `No such session: ${key}` })
  // The debrief document (if any) stays in the shared pool — it may be linked
  // from jExplain or jTicket; delete it there if it's unwanted.
  await deleteGrill(key)
  return { ok: true }
})
