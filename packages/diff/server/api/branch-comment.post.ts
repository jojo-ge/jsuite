import { randomUUID } from 'node:crypto'

export default defineEventHandler(async (event) => {
  const b = await readBody(event)
  const repo = resolveRepoDir(String(b?.repo ?? ''))
  const branch = String(b?.branch ?? '')
  if (!branch) throw createError({ statusCode: 400, message: 'missing branch' })

  const body = String(b?.body ?? '').trim()
  if (!body) throw createError({ statusCode: 400, message: 'empty comment' })
  const filePath = String(b?.path ?? '')
  const line = Number(b?.line)
  const side = String(b?.side ?? '')
  if (!filePath || !Number.isInteger(line) || !['LEFT', 'RIGHT'].includes(side)) {
    throw createError({ statusCode: 400, message: 'need path, line, side' })
  }

  return addBranchComment(repo, branch, {
    id: randomUUID(),
    path: filePath,
    line,
    side: side as 'LEFT' | 'RIGHT',
    body,
    createdAt: new Date().toISOString(),
  })
})
