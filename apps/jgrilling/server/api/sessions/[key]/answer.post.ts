/**
 * Record the user's answer to the open question. Body: { answer }
 * Returns the updated session; the client then calls /next for the follow-up.
 */
export default defineEventHandler(async (event) => {
  const key = String(getRouterParam(event, 'key'))
  const session = await readGrill(key)
  if (!session) throw createError({ statusCode: 404, message: `No such session: ${key}` })
  if (session.status === 'done') throw createError({ statusCode: 400, message: 'session is already done' })

  const answer = String(((await readBody(event)) ?? {}).answer ?? '').trim()
  if (!answer) throw createError({ statusCode: 400, message: 'missing `answer`' })

  const turn = openTurn(session)
  if (!turn) throw createError({ statusCode: 409, message: 'no open question to answer' })

  turn.answer = answer
  turn.answeredAt = new Date().toISOString()
  await writeGrill(session)
  return session
})
