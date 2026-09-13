import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { KataAttempt } from '../../../../app/utils/kataTypes'

/**
 * Mark it: the human has written the piece in the repo and hands it to Claude.
 * Body: { dispatch?: boolean }  (default true)
 *
 * Records the attempt — the sandbox entry file as submitted (repo katas:
 * the target file's diff against the scaffold commit), for the transcript — and dispatches a marking session into herdr
 * (see dispatchMarker). The session reads the kata off /full, checks the code
 * against the tests and the reference answer, and POSTs its verdict to
 * /attempts/:id/mark; the page sees it land over /watch.
 *
 * If herdr isn't reachable the attempt is still recorded (with
 * `marker.error`) and the response says so: retry via /attempts/:id/dispatch
 * once herdr is up, or run `/jcode-mark <key>` in any terminal.
 */
export default defineEventHandler(async (event) => {
  const key = String(getRouterParam(event, 'key'))
  const kata = await readKata(key)
  if (!kata) throw createError({ statusCode: 404, message: `No such kata: ${key}` })
  if (kata.status === 'passed') throw createError({ statusCode: 400, message: 'kata already passed' })
  if (markingAttempt(kata)) throw createError({ statusCode: 409, message: 'an attempt is already being marked' })

  const body = (await readBody(event).catch(() => null)) ?? {}
  const dispatch = body.dispatch !== false

  const n = kata.attempts.length + 1
  const attempt: KataAttempt = {
    id: `a${n}-${Date.now().toString(36)}`,
    n,
    submittedAt: new Date().toISOString(),
    ...(kata.sandbox
      ? { code: await readFile(join(kata.sandbox.dir, kata.sandbox.entry), 'utf8').catch(() => undefined) }
      : { diff: await targetDiff(kata.repoPath, kata.target.file) }),
    afterReveal: kata.revealed || undefined,
    status: 'marking',
  }
  kata.attempts.push(attempt)
  kata.status = 'marking'
  await writeKata(kata)

  if (!dispatch) return { attempt, dispatched: false, prompt: `/jcode-mark ${kata.key} attempt=${n}` }
  return dispatchMarker(kata.key, attempt.id)
})
