export default defineEventHandler(async (event) => {
  const path = resolveRepoPath(event)
  const number = String(getQuery(event).number ?? '')
  if (!/^\d+$/.test(number)) throw createError({ statusCode: 400, message: 'bad ?number=' })
  const out = await run(
    'gh',
    [
      'pr', 'view', number, '--json',
      'number,title,body,author,baseRefName,headRefName,isDraft,state,url,additions,deletions,changedFiles,createdAt,updatedAt,commits',
    ],
    path,
  )
  const { commits, ...pr } = JSON.parse(out)
  return {
    ...pr,
    commitCount: commits?.length ?? 0,
    lastPushedAt: commits?.at(-1)?.committedDate ?? null,
  }
})
