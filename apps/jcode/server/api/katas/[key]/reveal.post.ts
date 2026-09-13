/**
 * The last rung: show Claude's implementation so the human can code along.
 * Every remaining hint unlocks with it — there is nothing left to hide. The
 * kata stays open: Mark it still runs the tests and makes the commit.
 */
export default defineEventHandler(async (event) => {
  const key = String(getRouterParam(event, 'key'))
  const kata = await readKata(key)
  if (!kata) throw createError({ statusCode: 404, message: `No such kata: ${key}` })
  if (kata.status === 'passed') throw createError({ statusCode: 400, message: 'kata already passed' })
  if (!kata.revealed) {
    const now = new Date().toISOString()
    while (kata.hintsUnlocked < kata.hints.length) {
      kata.hintsUnlocked += 1
      kata.hintsUnlockedAt.push(now)
    }
    kata.revealed = true
    kata.revealedAt = now
    await writeKata(kata)
  }
  return kataView(kata)
})
