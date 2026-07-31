export default defineEventHandler(async (event) => {
  const repoDir = resolveRepoPath(event)
  const target = resolveTarget(event)
  const filePath = String(getQuery(event).path ?? '')
  if (!filePath) throw createError({ statusCode: 400, message: 'missing ?path=' })

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

  const lines = content.split('\n')
  if (lines.at(-1) === '') lines.pop()
  return { lines: await highlightLines(lines, filePath) }
})
