import { resolve, sep } from 'node:path'

export default defineEventHandler(async (event) => {
  const b = await readBody(event)
  const repoDir = resolveRepoDir(String(b?.repo ?? ''))
  const filePath = String(b?.path ?? '')
  const line = Number.isInteger(b?.line) && b.line > 0 ? b.line : 1
  if (!filePath) throw createError({ statusCode: 400, message: 'missing path' })

  const abs = resolve(repoDir, filePath)
  if (abs !== repoDir && !abs.startsWith(repoDir + sep)) {
    throw createError({ statusCode: 400, message: 'path escapes repo' })
  }

  await run('code', ['-g', `${abs}:${line}`], repoDir)
  return { ok: true }
})
