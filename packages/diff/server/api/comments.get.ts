export default defineEventHandler(async (event) => {
  const path = resolveRepoPath(event)
  const number = String(getQuery(event).number ?? '')
  if (!/^\d+$/.test(number)) throw createError({ statusCode: 400, message: 'bad ?number=' })

  const out = await run(
    'gh',
    ['api', `repos/{owner}/{repo}/pulls/${number}/comments?per_page=100`],
    path,
  )
  return JSON.parse(out).map((c: any) => ({
    id: c.id as number,
    inReplyTo: (c.in_reply_to_id ?? null) as number | null,
    path: c.path as string,
    line: (c.line ?? null) as number | null,
    side: (c.side ?? 'RIGHT') as 'LEFT' | 'RIGHT',
    body: c.body as string,
    user: (c.user?.login ?? '') as string,
    createdAt: c.created_at as string,
    outdated: c.line == null,
  }))
})
