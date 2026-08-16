export default defineEventHandler(async (event) => {
  const path = resolveRepoPath(event)
  const force = !!getQuery(event).force
  let prs = force ? null : loadPrList(path)
  if (!prs) {
    const out = await run(
      'gh',
      [
        'pr', 'list', '--limit', '100', '--json',
        'number,title,author,headRefName,baseRefName,isDraft,updatedAt,additions,deletions,reviewDecision,reviewRequests,url',
      ],
      path,
    )
    prs = JSON.parse(out)
    savePrList(path, prs!)
  }
  return prs!.map((pr: any) => ({
    ...pr,
    ratingScore: loadRating(path, String(pr.number))?.rating.score ?? null,
  }))
})
