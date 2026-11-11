// The Review setup tab's Assess button: dispatch one Fable 5.2 /jreview-assess
// session that reads the PR, writes the reviewers' brief, adds check tickets
// if the PR needs them, saves the review plan and reports back
// (POST …/pr-review/assessed). Body: { autoStart?: boolean } — start the plan
// as soon as it lands (default true). 409 while a run or a live assessor is going.
export default defineEventHandler(async (event) => {
  const body = (await readBody<{ autoStart?: boolean }>(event)) ?? {}
  return startAssessment(String(getRouterParam(event, 'id')), body.autoStart !== false)
})
