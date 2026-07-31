// Turn a locally-reviewed branch into a PR and flush every draft comment onto
// it in one shot: push the branch, `gh pr create`, then replay the stored
// branch comments as inline review comments on the new PR. The local drafts
// are cleared only after a successful create; individual comments that fail to
// post (e.g. a line git no longer maps into the diff) are reported, not fatal.
export default defineEventHandler(async (event) => {
  const b = await readBody(event)
  const repo = resolveRepoDir(String(b?.repo ?? ''))
  const branch = String(b?.branch ?? '')
  if (!branch) throw createError({ statusCode: 400, message: 'missing branch' })
  const title = String(b?.title ?? '').trim()
  if (!title) throw createError({ statusCode: 400, message: 'a PR title is required' })
  const body = String(b?.body ?? '')
  const base = String(b?.base ?? '').trim()
  const draft = !!b?.draft

  // 1. Push the branch so GitHub has the head the PR will point at.
  await run('git', ['push', '--set-upstream', 'origin', `${branch}:${branch}`], repo)

  // 2. Create the PR non-interactively.
  const createArgs = ['pr', 'create', '--head', branch, '--title', title, '--body', body]
  if (base) createArgs.push('--base', base)
  if (draft) createArgs.push('--draft')
  await run('gh', createArgs, repo)

  // 3. Resolve the new PR's number + head sha (needed to anchor comments).
  const pr = JSON.parse(await run('gh', ['pr', 'view', branch, '--json', 'number,headRefOid,url'], repo))
  const number = String(pr.number)
  const headOid = String(pr.headRefOid)

  // 4. Replay the draft comments as inline review comments.
  const drafts = loadBranchComments(repo, branch)
  const failed: { body: string; error: string }[] = []
  let posted = 0
  for (const c of drafts) {
    try {
      await run(
        'gh',
        [
          'api', `repos/{owner}/{repo}/pulls/${number}/comments`,
          '-f', `body=${c.body}`,
          '-f', `commit_id=${headOid}`,
          '-f', `path=${c.path}`,
          '-F', `line=${c.line}`,
          '-f', `side=${c.side}`,
        ],
        repo,
      )
      // Drop each draft as soon as it lands, so a retry only re-sends failures.
      deleteBranchComment(repo, branch, c.id)
      posted++
    } catch (err: any) {
      failed.push({ body: c.body.slice(0, 80), error: String(err.data?.message ?? err.message ?? err).slice(0, 200) })
    }
  }

  return { number, url: pr.url as string, posted, failed }
})
