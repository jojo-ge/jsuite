// Open the project's ONE real GitHub PR: integration branch → its base (the
// default branch, or the integration branch of the build it stacks on —
// project.integrationBase, app/utils/stacking.ts).
// Ticket-sized review happens in local PRs; this is the roll-up the world sees.
// Pushes the branch first (so the PR reflects everything merged locally), then
// creates the PR via gh — or returns the existing one, so the button is safe to
// re-click.
import { effectiveBase, rollupPrCreateArgs } from '../../../../app/utils/stacking'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const store = loadStore()
  const project = findByRef(store.projects, id)
  if (!project) throw createError({ statusCode: 404, statusMessage: 'project not found' })

  const path = resolveRepoDir(project.repo)
  const branch = project.integrationBranch.trim()
  if (!branch) throw createError({ statusCode: 400, statusMessage: `${project.key} has no integration branch` })
  if (!(await localBranchExists(path, branch))) {
    throw createError({ statusCode: 400, statusMessage: `integration branch not in this clone: ${branch}` })
  }

  await run('git', ['push', '--set-upstream', 'origin', `${branch}:${branch}`], path)
  // The branch is on origin now and a PR is about to exist: the GitHub panel
  // must not answer from what it held before (forgotten again once it does).
  forgetRepoGithub(path)

  // Already open? Reuse it — the roll-up PR is singular by design.
  const listed = await run('gh', ['pr', 'list', '--head', branch, '--json', 'number,url', '--limit', '1'], path)
  const existing = (JSON.parse(listed) as { number: number; url: string }[])[0]
  if (existing) return { ...existing, created: false, branch }

  const ctx = await repoContext(path)
  const base = effectiveBase(project.integrationBase, ctx.defaultBranch)
  // A stacked PR needs its base on GitHub. Gone means the upstream was merged:
  // Sync from upstream moves this project onto what it merged into.
  if (base !== ctx.defaultBranch && !(await remoteBranchExists(path, base))) {
    throw createError({ statusCode: 409, statusMessage: `the base ${base} is not on origin — if the upstream build was merged, Sync from upstream first` })
  }
  const upstream = upstreamProjectOf(store, project)
  const mergedTickets = store.prs
    .filter((pr) => pr.projectId === project.id && pr.status === 'merged')
    .map((pr) => store.tickets.find((t) => t.id === pr.ticketId))
    .filter((t): t is Ticket => !!t)
  const body = [
    `${project.key} — ${project.title}`,
    '',
    ...(base !== ctx.defaultBranch ? [`Stacked on \`${base}\`${upstream ? ` (${upstream.key} ${upstream.title})` : ''}: this PR shows only its own work.`, ''] : []),
    ...(mergedTickets.length ? ['Tickets landed via local PRs:', ...mergedTickets.map((t) => `- ${t.key} ${t.title}`)] : []),
  ].join('\n')

  const out = await run('gh', rollupPrCreateArgs({ branch, base, title: `${project.key} ${project.title}`, body }), path)
  forgetRepoGithub(path)
  const url = out.trim().split('\n').pop() ?? ''
  return { url, created: true, branch, base }
})
