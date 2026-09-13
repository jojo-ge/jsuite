/**
 * The whole record — hints and the answer included, whatever the human has
 * reached. This is the MARKER's read (skill `jcode-mark`) and the build
 * session's way to retrieve what it hid. The kata page never calls it: the
 * page reads /api/katas/:key, which stops at the reached rung.
 */
export default defineEventHandler(async (event) => {
  const key = String(getRouterParam(event, 'key'))
  const kata = await readKata(key)
  if (!kata) throw createError({ statusCode: 404, message: `No such kata: ${key}` })
  return kata
})
