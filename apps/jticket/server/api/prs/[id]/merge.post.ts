// The merge button. Squash-merges the PR's head branch onto its base (the
// integration branch) with plumbing — no checkout, the working tree is never
// touched — then deletes the head branch and moves the ticket to 'merged'.
//
// Everything stays local until the project's roll-up PR exists. From that
// point the branch is something other people read, and a merge that didn't
// push would leave the PR describing work it doesn't contain — so the push
// rides along with the merge (best-effort: offline never turns a landed merge
// into an error, and POST /api/projects/:id/sync is still there to retry).
//
// A conflict refuses cleanly: the repo is left exactly as it was, the PR is
// marked 'conflicted' with the files recorded, and the answer is a 409 —
// rebase the head branch onto the base, then merge again.
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const store = loadStore()
  const pr = findPrRef(store, id)
  if (!pr) throw createError({ statusCode: 404, statusMessage: 'PR not found' })
  if (pr.status === 'merged') throw createError({ statusCode: 409, statusMessage: `${pr.key} is already merged` })
  if (pr.status === 'closed') throw createError({ statusCode: 409, statusMessage: `${pr.key} is closed — reopen it first` })

  const project = store.projects.find((p) => p.id === pr.projectId)
  if (!project) throw createError({ statusCode: 400, statusMessage: 'the PR\'s project is gone' })
  const path = resolveRepoDir(project.repo)

  // The squash commit reads like the PR: title as subject, description as body.
  const message = pr.description ? `${pr.title}\n\n${pr.description}` : pr.title
  const result = await squashMergePr(path, { head: pr.headBranch, base: pr.baseBranch, message })

  const ts = now()
  if (!result.ok) {
    pr.status = 'conflicted'
    pr.conflictFiles = result.conflictFiles
    pr.updatedAt = ts
    saveStore(store)
    throw createError({
      statusCode: 409,
      statusMessage: `merge conflicts in: ${result.conflictFiles.join(', ')}`.slice(0, 500),
    })
  }

  pr.status = 'merged'
  pr.conflictFiles = []
  pr.mergeCommit = result.commit
  pr.mergeParent = result.parent
  pr.mergedAt = ts
  pr.updatedAt = ts

  // Merging the PR is the event that means the ticket landed.
  const ticket = store.tickets.find((t) => t.id === pr.ticketId)
  if (ticket) {
    ticket.completedAt = stampCompletion(ticket, 'merged', ts)
    ticket.status = 'merged'
    ticket.updatedAt = ts
  }

  saveStore(store)

  // Only the project's own integration branch is jTicket's to push — a PR
  // based on anything else (a ticket stacked on a ticket) is nobody's roll-up.
  const push =
    project.rollupPr && pr.baseBranch === project.integrationBranch.trim()
      ? await pushBranch(path, pr.baseBranch)
      : null

  return {
    ...withPrDerived(store, pr, path),
    headDeleted: result.headDeleted,
    jdiffBaseUrl: jdiffBranchUrl(path, pr.baseBranch),
    // null = the branch is still private, so nothing was owed to origin.
    pushed: push ? push.pushed : null,
    pushError: push && !push.pushed ? push.error : null,
  }
})
