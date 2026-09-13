/**
 * The marker's verdict. Body:
 *   { result: 'passed' | 'failed', verdict: markdown, feedback?: Block[],
 *     testOutput?: string, commit?: string }
 *
 * `:id` is the attempt id or its number. A failed attempt unlocks the next
 * hint rung (if any) — that is the ladder: brief → hint → hint → answer. A
 * passed attempt closes the kata; `commit` is the hash the marker made.
 *
 * The verdict and feedback must not contain the answer before the human has
 * revealed it — the `jcode-mark` skill owns that rule; the API only stores.
 */
export default defineEventHandler(async (event) => {
  const key = String(getRouterParam(event, 'key'))
  const id = String(getRouterParam(event, 'id'))
  const kata = await readKata(key)
  if (!kata) throw createError({ statusCode: 404, message: `No such kata: ${key}` })

  const attempt = kata.attempts.find((a) => a.id === id || String(a.n) === id)
  if (!attempt) throw createError({ statusCode: 404, message: `No such attempt: ${id}` })

  const body = (await readBody(event)) ?? {}
  const result = String(body.result ?? '').trim()
  if (result !== 'passed' && result !== 'failed') {
    throw createError({ statusCode: 400, message: '`result` must be "passed" or "failed"' })
  }
  const verdict = String(body.verdict ?? '').trim()
  if (!verdict) throw createError({ statusCode: 400, message: 'missing `verdict`' })

  const now = new Date().toISOString()
  attempt.status = result
  attempt.markedAt = now
  attempt.verdict = verdict
  attempt.testOutput = String(body.testOutput ?? '').trim() || undefined
  attempt.commit = String(body.commit ?? '').trim() || undefined
  attempt.feedback = Array.isArray(body.feedback) && body.feedback.length
    ? await materialiseBlocks(`${kata.key}-attempt-${attempt.n}`, body.feedback)
    : undefined

  if (result === 'passed') {
    kata.status = 'passed'
  } else {
    kata.status = 'open'
    // The failed attempt earns the next rung.
    if (kata.hintsUnlocked < kata.hints.length) {
      kata.hintsUnlocked += 1
      kata.hintsUnlockedAt.push(now)
    }
  }
  await writeKata(kata)
  return kataView(kata)
})
