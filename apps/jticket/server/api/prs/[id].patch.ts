// Edit a local PR: title, description, branches, or lifecycle. Status accepts
// only 'closed' and 'open' (close without merging / reopen) — 'merged' and
// 'conflicted' are outcomes of the merge endpoint, never set by hand.
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const body = await readBody<Partial<LocalPr>>(event)
  const store = loadStore()
  const pr = findPrRef(store, id)
  if (!pr) throw createError({ statusCode: 404, statusMessage: 'PR not found' })
  if (pr.status === 'merged') throw createError({ statusCode: 409, statusMessage: `${pr.key} is merged — nothing left to edit` })

  if (body.title !== undefined && body.title.trim()) pr.title = body.title.trim()
  if (body.description !== undefined) pr.description = String(body.description).trim()

  for (const side of ['headBranch', 'baseBranch'] as const) {
    const v = body[side]
    if (v === undefined) continue
    const branch = String(v).trim()
    if (!isSafeRef(branch)) throw createError({ statusCode: 400, statusMessage: `not a usable branch name: ${branch}` })
    pr[side] = branch
    // A retargeted PR is a different merge — a recorded conflict no longer applies.
    if (pr.status === 'conflicted') { pr.status = 'open'; pr.conflictFiles = [] }
  }

  if (body.status !== undefined) {
    if (body.status === 'closed') { pr.status = 'closed'; pr.conflictFiles = [] }
    else if (body.status === 'open' && pr.status === 'closed') pr.status = 'open'
    else if (body.status !== pr.status) {
      throw createError({ statusCode: 400, statusMessage: `status can only be set to 'closed' or back to 'open' — '${body.status}' is a merge outcome` })
    }
  }

  pr.updatedAt = now()
  saveStore(store)
  const project = store.projects.find((p) => p.id === pr.projectId)
  return withPrDerived(store, pr, project?.repo.trim() ? expandHome(project.repo) : null)
})
