/**
 * Record the user's answer to the open question. Body: { answer, optionId? }
 * Returns the updated session; the interviewer's monitor sees the file change.
 *
 * `optionId` is set when the answer came from picking one of the question's
 * options — it tells the interviewer which case the user bought, not just the
 * words.
 */
export default defineEventHandler(async (event) => {
  const key = String(getRouterParam(event, 'key'))
  const session = await readGrill(key)
  if (!session) throw createError({ statusCode: 404, message: `No such session: ${key}` })
  if (session.status === 'done') throw createError({ statusCode: 400, message: 'session is already done' })

  const body = (await readBody(event)) ?? {}
  const answer = String(body.answer ?? '').trim()
  if (!answer) throw createError({ statusCode: 400, message: 'missing `answer`' })

  const turn = openTurn(session)
  if (!turn) throw createError({ statusCode: 409, message: 'no open question to answer' })

  const optionId = String(body.optionId ?? '').trim()
  turn.answer = answer
  turn.answeredOptionId = turn.options?.some((o) => o.id === optionId) ? optionId : undefined
  turn.answeredAt = new Date().toISOString()
  await writeGrill(session)
  return session
})
