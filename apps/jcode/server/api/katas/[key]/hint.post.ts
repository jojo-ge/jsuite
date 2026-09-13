/**
 * The human asks for the next rung without submitting ("I'm stuck"). Unlocks
 * one hint; 409 when there are none left (the page then offers the reveal).
 */
export default defineEventHandler(async (event) => {
  const key = String(getRouterParam(event, 'key'))
  const kata = await readKata(key)
  if (!kata) throw createError({ statusCode: 404, message: `No such kata: ${key}` })
  if (kata.status === 'passed') throw createError({ statusCode: 400, message: 'kata already passed' })
  if (kata.hintsUnlocked >= kata.hints.length) {
    throw createError({ statusCode: 409, message: 'no hints left — the next rung is the answer' })
  }
  kata.hintsUnlocked += 1
  kata.hintsUnlockedAt.push(new Date().toISOString())
  await writeKata(kata)
  return kataView(kata)
})
