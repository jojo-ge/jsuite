// Get-or-create the PR review project for one GitHub pull request — what the
// Reviews board's Make review project button calls. Body: { repo, pr, review?, reviewers? }
//   repo      — the local clone's main checkout (the PR's GitHub repo is its origin)
//   pr        — the PR number
//   review    — also start the review now (default false: the human presses
//               Start review in the project's Review tab)
//   reviewers — with review: 2…4 (default 3)
// The PR head is fetched into the project's never-pushed branch jreview/pr-<n>
// (a fork's PR works too). An existing project for the same repo + PR is
// returned with its PR refreshed, never duplicated.
// Returns { project, created, review?: { key, url }, reviewError? }.
export default defineEventHandler(async (event) => {
  const body = (await readBody<{ repo?: string; pr?: number | string; review?: boolean; reviewers?: number }>(event)) ?? {}
  const { project, created } = await ensurePrReviewProject(String(body.repo ?? ''), Number(body.pr))
  setResponseStatus(event, created ? 201 : 200)
  if (body.review !== true) return { project, created }
  try {
    const res = await startPrReview(project.id, body.reviewers)
    return { project: loadStore().projects.find((p) => p.id === project.id), created, review: { key: res.key, url: `${JTICKET_PUBLIC}${res.path}` } }
  } catch (err: any) {
    return { project, created, reviewError: String(err?.statusMessage ?? err?.message ?? err) }
  }
})
