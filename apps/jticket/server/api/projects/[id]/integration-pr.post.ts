// Open the project's ONE real GitHub PR: integration branch → default branch.
// Ticket-sized review happens in local PRs; this is the roll-up the world sees.
// Pushes the branch first (so the PR reflects everything merged locally), then
// creates the PR via gh — or returns the existing one, so the button is safe to
// re-click.
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const store = loadStore()
  const project = store.projects.find((p) => p.id === id || p.key === id)
  if (!project) throw createError({ statusCode: 404, statusMessage: 'project not found' })

  const path = resolveRepoDir(project.repo)
  const branch = project.integrationBranch.trim()
  if (!branch) throw createError({ statusCode: 400, statusMessage: `${project.key} has no integration branch` })
  if (!(await localBranchExists(path, branch))) {
    throw createError({ statusCode: 400, statusMessage: `integration branch not in this clone: ${branch}` })
  }

  await run('git', ['push', '--set-upstream', 'origin', `${branch}:${branch}`], path)

  // Already open? Reuse it — the roll-up PR is singular by design.
  const listed = await run('gh', ['pr', 'list', '--head', branch, '--json', 'number,url', '--limit', '1'], path)
  const existing = (JSON.parse(listed) as { number: number; url: string }[])[0]
  if (existing) return { ...existing, created: false, branch }

  const ctx = await repoContext(path)
  const mergedTickets = store.prs
    .filter((pr) => pr.projectId === project.id && pr.status === 'merged')
    .map((pr) => store.tickets.find((t) => t.id === pr.ticketId))
    .filter((t): t is Ticket => !!t)
  const body = [
    `${project.key} — ${project.title}`,
    '',
    ...(mergedTickets.length ? ['Tickets landed via local PRs:', ...mergedTickets.map((t) => `- ${t.key} ${t.title}`)] : []),
  ].join('\n')

  const out = await run(
    'gh',
    ['pr', 'create', '--head', branch, '--base', ctx.defaultBranch, '--title', `${project.key} ${project.title}`, '--body', body],
    path,
  )
  const url = out.trim().split('\n').pop() ?? ''
  return { url, created: true, branch }
})
