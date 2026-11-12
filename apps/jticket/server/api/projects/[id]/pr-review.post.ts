// The PR picker on a review project that has no pull request yet (one made
// from the create modal — POST /api/projects {mode: 'prreview', repo}): attach
// PR `pr` of the project's repo. Body: { pr }. The PR head is fetched onto the
// never-pushed local branch jreview/pr-<n>, which becomes the project's
// integration branch; nothing is started — the human presses Start review in
// the Review tab. 409 when the project already has its PR, or another project
// reviews that one. Returns the project.
export default defineEventHandler(async (event) => {
  const body = (await readBody<{ pr?: number | string }>(event)) ?? {}
  return attachPrToReviewProject(getRouterParam(event, 'id'), Number(body.pr))
})
