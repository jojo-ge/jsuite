// The herdr review session's sign-off: closes the dispatch (so the UI stops
// showing the run) and records any per-tool failures the session hit, so a
// panel with no artifact can say why instead of sitting blank.
//
// Body: { repo, number | branch (+ base?), failures?: [{ tool?, message }] }
export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const repo = resolveRepoDir(String(body?.repo ?? ''))
  const target = resolveTargetFromBody(body)

  const failures = (Array.isArray(body?.failures) ? body.failures : [])
    .filter((f: any) => typeof f?.message === 'string' && f.message.trim())
    .map((f: any) => ({
      jobKind: 'analyze',
      ...(f.tool ? { tool: String(f.tool) } : {}),
      message: String(f.message).slice(0, 500),
      at: new Date().toISOString(),
    }))
  if (failures.length) {
    saveFailures({ repo, number: target.storeKey, failures })
    for (const f of failures) console.error(`[analyze ${target.storeKey}] ${f.tool ?? 'run'} failed: ${f.message}`)
  }

  const dispatch = clearReviewDispatch(repo, target.storeKey)
  return { done: true, wasTracked: !!dispatch }
})
