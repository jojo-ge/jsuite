import { randomUUID } from 'node:crypto'
import { ASK_QUESTIONS, type SavedAsk } from '../../app/utils/askQuestions'

// Where the herdr `jdiff-ask` session hands its answer back. Saved into the
// same ask store the diff view reads; the client polls /api/asks after
// dispatching and folds the new entry in when it appears.
//
// Body: { repo, number | branch (+ base?), path, line, side, question, answer }
export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const repo = resolveRepoDir(String(body?.repo ?? ''))
  const target = resolveTargetFromBody(body)
  const path = String(body?.path ?? '')
  if (!path) throw createError({ statusCode: 400, message: 'missing path' })
  const line = Number(body?.line)
  if (!Number.isInteger(line) || line < 1) throw createError({ statusCode: 400, message: 'bad line' })
  const side = String(body?.side ?? '')
  if (!['LEFT', 'RIGHT'].includes(side)) throw createError({ statusCode: 400, message: 'bad side' })
  const question = ASK_QUESTIONS.find((q) => q.id === body?.question)
  if (!question) throw createError({ statusCode: 400, message: 'unknown question' })
  const answer = String(body?.answer ?? '').trim()
  if (!answer) throw createError({ statusCode: 400, message: 'missing answer' })

  const ask: SavedAsk = {
    id: randomUUID(),
    repo,
    number: target.storeKey,
    path,
    line,
    side: side as 'LEFT' | 'RIGHT',
    questionId: question.id,
    question: question.label,
    answer,
    createdAt: new Date().toISOString(),
  }
  saveAsk(ask)
  return { ask }
})
