// Posts one answered "ask yourself" question back to the PR as a regular
// conversation comment (an issue comment, not an inline review comment).
export default defineEventHandler(async (event) => {
  const b = await readBody(event)
  const path = resolveRepoDir(String(b?.repo ?? ''))
  const number = String(b?.number ?? '')
  if (!/^\d+$/.test(number)) throw createError({ statusCode: 400, message: 'bad number' })

  const saved = loadAskYourself(path, number)
  const index = Number(b?.index)
  const q = saved?.questions[index]
  if (!saved || !q) throw createError({ statusCode: 404, message: 'no such question' })

  const answer = String(b?.answer ?? '').trim()
  if (!answer) throw createError({ statusCode: 400, message: 'empty answer' })

  const body = `**ask yourself${q.topic ? ` — ${q.topic}` : ''}**\n\n> ${q.question.replace(/\n/g, '\n> ')}\n\n${answer}`
  const c = JSON.parse(
    await run('gh', ['api', `repos/{owner}/{repo}/issues/${number}/comments`, '-f', `body=${body}`], path),
  )

  q.answer = answer
  q.postedUrl = c.html_url
  saveAskYourself(saved)
  return { url: c.html_url }
})
