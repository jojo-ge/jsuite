// Cut the ticket's work branch: a LOCAL branch off the project's integration
// branch, recorded on the ticket (ticket.branch) so the hand-off prompt can
// name it and a local PR knows its head. Never pushed — single-ticket work
// stays local until its PR merges into the integration branch.
//
// Idempotent: a branch that already exists (here or cut by hand) is adopted,
// not re-cut.
//
// Body: { branch? }  — defaults to 'tick/<TICK-n>-<title-slug>'
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const body = await readBody<{ branch?: string }>(event).catch(() => ({}) as { branch?: string })
  const store = loadStore()
  const ticket = store.tickets.find((t) => t.id === id || t.key === id)
  if (!ticket) throw createError({ statusCode: 404, statusMessage: 'ticket not found' })
  const project = store.projects.find((p) => p.id === ticket.projectId)
  if (!project) throw createError({ statusCode: 400, statusMessage: `${ticket.key} has no project — branches are cut in a project's repo` })

  const path = resolveRepoDir(project.repo)
  const base = project.integrationBranch.trim()
  if (!base) throw createError({ statusCode: 400, statusMessage: `${project.key} has no integration branch — cut that first` })

  const branch = (body?.branch ?? '').trim() || ticket.branch.trim() || suggestTicketBranchName(ticket)
  if (!isSafeRef(branch)) throw createError({ statusCode: 400, statusMessage: `not a usable branch name: ${branch}` })

  // The local integration branch is the source of truth for ticket work; only
  // when it hasn't been checked out here yet does origin's copy stand in.
  const existed = !!(await branchOid(path, branch))
  if (!existed) {
    const startPoint = (await branchOid(path, base)) ? base : `refs/remotes/origin/${base}`
    await run('git', ['branch', branch, startPoint], path)
  }

  ticket.branch = branch
  ticket.updatedAt = now()
  saveStore(store)

  return {
    branch,
    base,
    created: !existed,
    adopted: existed,
    jdiffUrl: jdiffBranchUrl(path, branch),
  }
})
