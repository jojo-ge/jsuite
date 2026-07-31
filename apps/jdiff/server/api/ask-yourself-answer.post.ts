// Persists the reviewer's draft answer to one "ask yourself" question, so a
// half-written answer survives a reload.
export default defineEventHandler(async (event) => {
  const b = await readBody(event)
  const path = resolveRepoDir(String(b?.repo ?? ''))
  const target = resolveTargetFromBody(b)

  const saved = loadAskYourself(path, target.storeKey)
  const index = Number(b?.index)
  const q = saved?.questions[index]
  if (!saved || !q) throw createError({ statusCode: 404, message: 'no such question' })

  q.answer = String(b?.answer ?? '')
  saveAskYourself(saved)
  return { ok: true }
})
