export default defineEventHandler(async (event) => {
  const b = await readBody(event)
  const repo = resolveRepoDir(String(b?.repo ?? ''))
  const branch = String(b?.branch ?? '')
  const id = String(b?.id ?? '')
  if (!branch || !id) throw createError({ statusCode: 400, message: 'need branch and id' })
  deleteBranchComment(repo, branch, id)
  return { ok: true }
})
