// Start a review that belongs to this project: four (or `reviewers`)
// Opus reviewers in herdr, then a triage session — the findings come back to
// the Review tab, where the human adds them to this project as tickets.
//
// A PR review project's is its PR's review instead (startPrReview): the PR
// head re-fetched, `reviewers` 2…4 (default 3), a consensus session in place
// of the triage. It takes no branch or base, and 409s while one is still out.
//
// A plan review project's is its plan's (startPlanReview): no branch, no
// base, no worktree — the reviewers read the plan through jTicket.
//
// Body: { branch?, base?, reviewers? }
//   branch    — defaults to the integration branch; a branch that's only on
//               origin is passed as 'origin/<name>' (the engine's convention)
//   base      — the fixed point; the engine defaults it to the branch's open
//               PR's base, else origin's default branch
//   reviewers — 1…4, default 4
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const body = (await readBody<{ branch?: string; base?: string; reviewers?: number }>(event)) ?? {}
  const store = loadStore()
  const project = findByRef(store.projects, id)
  if (!project) throw createError({ statusCode: 404, statusMessage: 'project not found' })
  // A PR review project reviews one thing — its PR, head re-fetched — and as
  // an agreement review: findings every reviewer raised, verified, filed here
  // as record-only tickets, with a verdict and a summary to post. A triage
  // review would file work tickets on a board that holds only records.
  if (project.mode === 'prreview') {
    const res = await startPrReview(project.id, body.reviewers)
    return { key: res.key, url: `${JTICKET_PUBLIC}${res.path}` }
  }
  // A plan review project's is its plan's review: the same agreement review,
  // reading the plan's spec and ticket plan instead of a diff (startPlanReview).
  if (project.mode === 'planreview') {
    const res = await startPlanReview(project.id, body.reviewers)
    return { key: res.key, url: `${JTICKET_PUBLIC}${res.path}` }
  }

  const path = resolveRepoDir(project.repo)
  const branch = (body.branch ?? '').trim() || project.integrationBranch.trim()
  if (!branch) {
    throw createError({ statusCode: 400, statusMessage: `${project.key} has no integration branch — pick a branch to review` })
  }
  let base = (body.base ?? '').trim()
  for (const ref of [branch, base].filter(Boolean)) {
    if (!isSafeRef(ref)) throw createError({ statusCode: 400, statusMessage: `not a usable ref: ${ref}` })
  }
  // A stacked build is reviewed from where it meets its upstream, so the
  // reviewers read only its own work — even before its roll-up PR exists
  // (whose base the engine would otherwise pick) or after the upstream's
  // branch is gone (integrationBase.ts).
  if (!base && branch === project.integrationBranch.trim() && (project.integrationBase ?? '').trim()) {
    const own = await integrationDiffBase(project, path)
    if (own.stacked) base = own.ref
  }

  // The engine may cut a worktree for a branch that isn't checked out — seconds on a big repo.
  const res = await createReview({
    repoPath: path,
    branch,
    ...(base ? { base } : {}),
    ...(body.reviewers ? { reviewers: body.reviewers } : {}),
    project: project.key,
  })
  return { key: res.key, url: `${JTICKET_PUBLIC}${res.path}` }
})
