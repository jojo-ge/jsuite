// Open a local PR for a ticket: the ticket's branch, targeted at its project's
// integration branch, reviewed and merged entirely inside jTicket. One ticket
// per PR, one open PR per ticket — the PR *is* the ticket's in-review state.
//
// Body: { ticket: string,            // ticket id or key (required)
//         title?, description?,      // default: '<TICK-n> <ticket title>' / ''
//         headBranch?,               // default: the ticket's recorded branch
//         baseBranch? }              // default: the project's integration branch
export default defineEventHandler(async (event) => {
  const body = await readBody<{
    ticket?: string
    ticketId?: string
    title?: string
    description?: string
    headBranch?: string
    baseBranch?: string
  }>(event)

  const store = loadStore()
  const ref = body?.ticket ?? body?.ticketId
  const ticket = store.tickets.find((t) => t.id === ref || t.key === ref)
  if (!ticket) throw createError({ statusCode: 400, statusMessage: `unknown ticket: ${ref}` })
  const project = store.projects.find((p) => p.id === ticket.projectId)
  if (!project) throw createError({ statusCode: 400, statusMessage: `${ticket.key} has no project — local PRs live under a project's repo` })

  const path = resolveRepoDir(project.repo)

  const head = (body?.headBranch ?? '').trim() || ticket.branch
  if (!head) {
    throw createError({
      statusCode: 400,
      statusMessage: `${ticket.key} has no branch — cut one first (POST /api/tickets/${ticket.key}/branch) or pass headBranch`,
    })
  }
  const base = (body?.baseBranch ?? '').trim() || project.integrationBranch.trim()
  if (!base) {
    throw createError({
      statusCode: 400,
      statusMessage: `${project.key} has no integration branch — cut one first or pass baseBranch`,
    })
  }
  if (!isSafeRef(head)) throw createError({ statusCode: 400, statusMessage: `not a usable branch name: ${head}` })
  if (!isSafeRef(base)) throw createError({ statusCode: 400, statusMessage: `not a usable branch name: ${base}` })
  if (head === base) throw createError({ statusCode: 400, statusMessage: 'head and base are the same branch' })
  if (!(await branchOid(path, head))) throw createError({ statusCode: 400, statusMessage: `head branch not in this clone: ${head}` })
  if (!(await branchOid(path, base))) throw createError({ statusCode: 400, statusMessage: `base branch not in this clone: ${base}` })

  const existing = store.prs.find(
    (pr) => pr.ticketId === ticket.id && (pr.status === 'open' || pr.status === 'conflicted'),
  )
  if (existing) {
    throw createError({ statusCode: 409, statusMessage: `${ticket.key} already has an open PR: ${existing.key}` })
  }

  const ts = now()
  const pr: LocalPr = {
    id: newId('pr'),
    key: nextKey(store, 'pr'),
    title: (body?.title ?? '').trim() || `${ticket.key} ${ticket.title}`,
    description: (body?.description ?? '').trim(),
    ticketId: ticket.id,
    projectId: project.id,
    headBranch: head,
    baseBranch: base,
    status: 'open',
    conflictFiles: [],
    mergeCommit: '',
    mergeParent: '',
    mergedAt: null,
    createdAt: ts,
    updatedAt: ts,
  }
  store.prs.push(pr)
  saveStore(store)

  setResponseStatus(event, 201)
  return {
    ...withPrDerived(store, pr, path),
    commits: await listPrCommits(path, base, head),
  }
})
