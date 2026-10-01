// Start a jReview review that belongs to this project: four (or `reviewers`)
// Opus reviewers in herdr, then a triage session — the findings come back to
// the Review tab, where the human adds them to this project as tickets.
//
// Body: { branch?, base?, reviewers? }
//   branch    — defaults to the integration branch; a branch that's only on
//               origin is passed as 'origin/<name>' (jReview's convention)
//   base      — the fixed point; jReview defaults it to the branch's open
//               PR's base, else origin's default branch
//   reviewers — 1…4, default 4
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const body = (await readBody<{ branch?: string; base?: string; reviewers?: number }>(event)) ?? {}
  const store = loadStore()
  const project = store.projects.find((p) => p.id === id || p.key === id)
  if (!project) throw createError({ statusCode: 404, statusMessage: 'project not found' })

  const path = resolveRepoDir(project.repo)
  const branch = (body.branch ?? '').trim() || project.integrationBranch.trim()
  if (!branch) {
    throw createError({ statusCode: 400, statusMessage: `${project.key} has no integration branch — pick a branch to review` })
  }
  const base = (body.base ?? '').trim()
  for (const ref of [branch, base].filter(Boolean)) {
    if (!isSafeRef(ref)) throw createError({ statusCode: 400, statusMessage: `not a usable ref: ${ref}` })
  }

  // jReview may cut a worktree for a branch that isn't checked out — seconds on a big repo.
  const res = await jreviewFetch<{ key: string; path: string }>('/api/reviews', {
    method: 'POST',
    timeout: 60_000,
    body: {
      repoPath: path,
      branch,
      ...(base ? { base } : {}),
      ...(body.reviewers ? { reviewers: body.reviewers } : {}),
      project: project.key,
    },
  })
  return { key: res.key, url: `${JREVIEW_PUBLIC}${res.path}` }
})
