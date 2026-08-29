import type { GrillOption, GrillTurn } from '../../../../app/utils/grillTypes'

/**
 * The interviewer posts its next question.
 * Body: { topic?, question, why?, blocks?, options?, recommendation? }
 *
 * A question is laid out in three phases:
 *   1. `question`  — the question itself, markdown.
 *   2. `why`       — why it needs answering now, markdown.
 *   3. `options[]` — the candidate answers, one tab each, every tab carrying
 *                    the case for that option as jspec blocks.
 *
 * `blocks` is optional shared context rendered between phase 1 and phase 2
 * (a table/diff/chart the whole question rests on) in the jspec/block-document
 * vocabulary; charts and images are materialised into the shared pools exactly
 * as documents are — the option bodies too. One open question at a time —
 * posting while one is unanswered is a 409.
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
  const question = String(body.question ?? '').trim()
  const rawBlocks = Array.isArray(body.blocks) ? body.blocks : []
  if (!question && !rawBlocks.length) {
    throw createError({ statusCode: 400, message: 'missing `question` — the question itself, in markdown' })
  }

  const rawOptions = Array.isArray(body.options) ? body.options : []
  const id = `q${session.turns.length + 1}`

  const options: GrillOption[] = []
  for (const [i, raw] of rawOptions.entries()) {
    const label = String(raw?.label ?? '').trim()
    if (!label) throw createError({ statusCode: 400, message: `options[${i}] is missing \`label\`` })
    const optId = sanitizeGrillKey(raw?.id ?? label) || `o${i + 1}`
    // `md` is the shorthand for an option whose case is plain prose.
    const optBlocks = Array.isArray(raw?.blocks) && raw.blocks.length
      ? raw.blocks
      : String(raw?.md ?? '').trim()
        ? [{ id: 'case', type: 'prose', md: String(raw.md) }]
        : []
    if (!optBlocks.length) {
      throw createError({ statusCode: 400, message: `options[${i}] (${label}) needs \`blocks\` or \`md\` — the case for it` })
    }
    const summary = String(raw?.summary ?? '').trim() || undefined
    options.push({
      id: optId,
      label,
      summary,
      recommended: Boolean(raw?.recommended),
      // Materialised per option so inline mermaid lands in the shared jChart
      // pool without options colliding with each other or with the context.
      blocks: await materialiseBlocks(`${session.key}-${id}-${optId}`, optBlocks),
      answer: String(raw?.answer ?? '').trim() || [label, summary].filter(Boolean).join(' — '),
    })
  }
  if (options.length && !options.some((o) => o.recommended)) {
    throw createError({ statusCode: 400, message: 'mark one option `recommended: true` — always recommend an answer' })
  }

  const recommended = options.find((o) => o.recommended)
  const recommendation = String(body.recommendation ?? '').trim() || recommended?.answer || ''
  if (!recommendation) {
    throw createError({ statusCode: 400, message: 'missing `recommendation` — always recommend an answer' })
  }

  const turn: GrillTurn = {
    id,
    topic: String(body.topic ?? '').trim() || 'next decision',
    question: question || undefined,
    why: String(body.why ?? '').trim() || undefined,
    blocks: await materialiseBlocks(`${session.key}-${id}`, rawBlocks),
    options: options.length ? options : undefined,
    recommendation,
    askedAt: new Date().toISOString(),
  }
  session.turns.push(turn)
  if (session.version < 3) session.version = 3
  await writeGrill(session)
  return { turn, path: `/g/${session.key}` }
})
