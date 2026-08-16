export default defineEventHandler(async (event) => {
  const path = resolveRepoPath(event)
  await run('git', ['rev-parse', '--is-inside-work-tree'], path)
  const out = await run('gh', ['repo', 'view', '--json', 'nameWithOwner,defaultBranchRef'], path)
  const info = JSON.parse(out)
  const viewer = (await run('gh', ['api', 'user', '--jq', '.login'], path)).trim()
  return {
    path,
    slug: info.nameWithOwner as string,
    defaultBranch: info.defaultBranchRef?.name as string,
    viewer,
  }
})
