import type { GrillTurn } from '../../../../app/utils/grillTypes'

/**
 * The interviewer posts its next question.
 * Body: { topic?, blocks, recommendation, why? }
 *
 * `blocks` is the question body in the jspec/block-document vocabulary
 * (prose, callout, compare, code, chart-with-mermaid, …); charts and images
 * are materialised into the shared pools exactly as documents are. One open
 * question at a time — posting while one is unanswered is a 409.
 */
export default defineEventHandler(async (event) => {
  const key = String(getRouterParam(event, 'key'))
  const session = await readGrill(key)
  if (!session) throw createError({ statusCode: 404, message: `No such session: ${key}` })
  if (session.status === 'done') throw createError({ statusCode: 400, message: 'session is already done' })
  const open = openTurn(session)
  if (open) {
    throw createError({ statusCode: 409, message: `question ${open.id} is still unanswered — wait for the answer` })
  }

  const body = (await readBody(event)) ?? {}
  const rawBlocks = Array.isArray(body.blocks) ? body.blocks : []
  if (!rawBlocks.length) throw createError({ statusCode: 400, message: 'missing `blocks` — the question body' })
  const recommendation = String(body.recommendation ?? '').trim()
  if (!recommendation) throw createError({ statusCode: 400, message: 'missing `recommendation` — always recommend an answer' })

  const id = `q${session.turns.length + 1}`
  const turn: GrillTurn = {
    id,
    topic: String(body.topic ?? '').trim() || 'next decision',
    // Materialised under a per-turn pseudo doc key so inline mermaid lands in
    // the shared jChart pool without turns colliding with each other.
    blocks: await materialiseBlocks(`${session.key}-${id}`, rawBlocks),
    recommendation,
    why: String(body.why ?? '').trim() || undefined,
    askedAt: new Date().toISOString(),
  }
  session.turns.push(turn)
  await writeGrill(session)
  return { turn, path: `/g/${session.key}` }
})
