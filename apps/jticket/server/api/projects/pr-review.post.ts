// Get-or-create the PR review project for one GitHub pull request — what the
// make-jreview-project skill calls. Body: { repo, pr, assess?, autoStart? }
//   repo      — the local clone's main checkout (the PR's GitHub repo is its origin)
//   pr        — the PR number
//   assess    — also dispatch the Fable assessor now (default false)
//   autoStart — with assess: start the review plan as soon as the assessment
//               lands (default true)
// The PR head is fetched into the project's never-pushed branch jreview/pr-<n>
// (a fork's PR works too). An existing project for the same repo + PR is
// returned with its PR refreshed, never duplicated.
// Returns { project, created, assessing?: { agent }, assessError? }.
export default defineEventHandler(async (event) => {
  const body = (await readBody<{ repo?: string; pr?: number | string; assess?: boolean; autoStart?: boolean }>(event)) ?? {}
  const { project, created } = await ensurePrReviewProject(String(body.repo ?? ''), Number(body.pr))
  setResponseStatus(event, created ? 201 : 200)
  if (body.assess !== true) return { project, created }
  try {
    const { agent } = await startAssessment(project.id, body.autoStart !== false)
    return { project: loadStore().projects.find((p) => p.id === project.id), created, assessing: { agent } }
  } catch (err: any) {
    return { project, created, assessError: String(err?.statusMessage ?? err?.message ?? err) }
  }
})
