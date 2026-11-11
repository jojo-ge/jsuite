// The /jreview-assess session's report-back — after it published the brief and
// saved the review plan. Body: { reviewers: 2–4, focus: string[], briefDoc:
// 'DOC-n', rationale, risk: 'low' | 'medium' | 'high' }.
// Records the assessment; when the Assess button asked to start once it
// landed (and the plan has no problems) the review plan starts.
// Returns { assessment, problems, started }.
export default defineEventHandler(async (event) => {
  const body = (await readBody(event)) ?? {}
  return recordAssessment(String(getRouterParam(event, 'id')), body)
})
