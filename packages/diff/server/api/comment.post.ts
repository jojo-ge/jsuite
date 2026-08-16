export default defineEventHandler(async (event) => {
  const b = await readBody(event)
  const path = resolveRepoDir(String(b?.repo ?? ''))
  const number = String(b?.number ?? '')
  if (!/^\d+$/.test(number)) throw createError({ statusCode: 400, message: 'bad number' })
  const text = String(b?.body ?? '').trim()
  if (!text) throw createError({ statusCode: 400, message: 'empty comment' })

  const args = ['api', `repos/{owner}/{repo}/pulls/${number}/comments`, '-f', `body=${text}`]

  if (b.inReplyTo) {
    args.push('-F', `in_reply_to=${Number(b.inReplyTo)}`)
  } else {
    const side = String(b?.side ?? '')
    const line = Number(b?.line)
    const filePath = String(b?.path ?? '')
    if (!['LEFT', 'RIGHT'].includes(side) || !Number.isInteger(line) || !filePath) {
      throw createError({ statusCode: 400, message: 'need path, line, side for a new comment' })
    }
    const head = JSON.parse(await run('gh', ['pr', 'view', number, '--json', 'headRefOid'], path))
    args.push(
      '-f', `commit_id=${head.headRefOid}`,
      '-f', `path=${filePath}`,
      '-F', `line=${line}`,
      '-f', `side=${side}`,
    )
  }

  const c = JSON.parse(await run('gh', args, path))
  return { id: c.id, url: c.html_url }
})
