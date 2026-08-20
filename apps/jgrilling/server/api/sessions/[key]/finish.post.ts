/**
 * The interviewer closes the session. Body: { verdict?, documentKey? }
 *
 * `documentKey` points at the debrief the interviewer published in the shared
 * documents pool; it must exist. Finishing with a question still open is
 * allowed — the interviewer owns the state — the question just stays
 * unanswered.
 */
export default defineEventHandler(async (event) => {
  const key = String(getRouterParam(event, 'key'))
  const session = await readGrill(key)
  if (!session) throw createError({ statusCode: 404, message: `No such session: ${key}` })

  const body = (await readBody(event)) ?? {}
  const documentKey = String(body.documentKey ?? '').trim()
  if (documentKey && !(await readDoc(documentKey))) {
    throw createError({ statusCode: 400, message: `no such document: ${documentKey} — publish the debrief first` })
  }

  session.status = 'done'
  session.verdict = String(body.verdict ?? '').trim() || session.verdict
  session.documentKey = documentKey || session.documentKey
  await writeGrill(session)
  return session
})
