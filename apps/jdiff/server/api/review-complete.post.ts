// A herdr session's sign-off: closes its dispatch (so the UI stops showing
// the run) and records any per-tool failures the session hit, so a panel
// with no artifact can say why instead of sitting blank.
//
// `job` names which dispatch is signing off; it defaults to 'analyze' so the
// original jdiff-review flow needs no change. Single-artifact jobs (detail,
// chains-scope, chain:<slug>) self-clear when their artifact POST lands, so
// for them this is a failures-only report — clearing an already-cleared
// dispatch is a harmless wasTracked:false.
//
// Body: { repo, number | branch (+ base?), job?, failures?: [{ tool?, message }] }
const JOB_RE = /^(analyze|detail|chains-scope|chain:[a-z][a-z0-9-]{0,39})$/

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const repo = resolveRepoDir(String(body?.repo ?? ''))
  const target = resolveTargetFromBody(body)
  const job = body?.job == null ? 'analyze' : String(body.job)
  if (!JOB_RE.test(job)) throw createError({ statusCode: 400, message: 'bad job' })

  const failures = (Array.isArray(body?.failures) ? body.failures : [])
    .filter((f: any) => typeof f?.message === 'string' && f.message.trim())
    .map((f: any) => ({
      jobKind: job,
      ...(f.tool ? { tool: String(f.tool) } : {}),
      message: String(f.message).slice(0, 500),
      at: new Date().toISOString(),
    }))
  if (failures.length) {
    appendFailures(repo, target.storeKey, failures)
    for (const f of failures) console.error(`[${job} ${target.storeKey}] ${f.tool ?? 'run'} failed: ${f.message}`)
  }

  const dispatch = clearReviewDispatch(repo, target.storeKey, job as ReviewJob)
  return { done: true, wasTracked: !!dispatch }
})
