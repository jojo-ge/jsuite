export default defineEventHandler(async (event) => {
  const repoDir = resolveRepoPath(event)
  const target = resolveTarget(event)
  const filePath = String(getQuery(event).path ?? '')
  if (!filePath) throw createError({ statusCode: 400, message: 'missing ?path=' })

  // A worktree scope's "head" version of a file is the index or the file on
  // disk, not a rev — prepareTarget works that out (and is cheap for a
  // branch), so only those scopes pay for it. Committed targets keep the
  // ref-only path, which skips the `gh pr view` + fetch a PR prepare costs.
  if (target.kind === 'branch' && target.scope !== 'committed') {
    const prepared = await prepareTarget(target, repoDir)
    const content = await showFile(prepared, repoDir, filePath, 'right')
    return { lines: await highlightLines(splitLines(content), filePath) }
  }

  const ref = headRefOf(target)
  let content: string
  try {
    content = await run('git', ['show', `${ref}:${filePath}`], repoDir)
  } catch {
    // PR ref may not exist yet (full view hit before the diff endpoint ran);
    // fetch it and retry. A branch ref is local, so a miss is a real error.
    if (target.kind !== 'pr') throw createError({ statusCode: 400, message: `cannot read ${filePath} at ${ref}` })
    await run('git', ['fetch', '--quiet', 'origin', `+refs/pull/${target.number}/head:${ref}`], repoDir)
    content = await run('git', ['show', `${ref}:${filePath}`], repoDir)
  }

  return { lines: await highlightLines(splitLines(content), filePath) }
})

function splitLines(content: string): string[] {
  const lines = content.split('\n')
  if (lines.at(-1) === '') lines.pop()
  return lines
}
