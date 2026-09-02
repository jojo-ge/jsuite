// Stop tracking dispatched runs. The claude sessions belong to herdr, not
// jDiff, so this can't kill them outright — it sends an interrupt (esc) to
// each agent best-effort and clears the dispatches so the UI settles. The
// panes stay open in herdr for the reviewer to inspect or close themselves.
//
// `job` picks what to cancel: 'analyze' (default), 'detail', 'chains' or
// 'hunt' — the last two clear a whole generation (the scope session AND every
// walker it fanned out). The fan-out loop checks the registry before each
// launch, so cancelling mid-fan-out also stops the walkers not yet started.
export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const path = resolveRepoDir(String(body?.repo ?? ''))
  const target = resolveTargetFromBody(body)
  const job = body?.job == null ? 'analyze' : String(body.job)

  const cleared: ReviewDispatch[] = []
  if (job === 'chains' || job === 'hunt') {
    const scope = job === 'chains' ? 'chains-scope' : 'hunt-scope'
    const prefix = job === 'chains' ? 'chain:' : 'issue:'
    for (const d of targetDispatches(path, target.storeKey)) {
      if (d.job !== scope && !d.job.startsWith(prefix)) continue
      clearReviewDispatch(path, target.storeKey, d.job)
      cleared.push(d)
    }
  } else if (job === 'analyze' || job === 'detail') {
    const d = clearReviewDispatch(path, target.storeKey, job)
    if (d) cleared.push(d)
  } else {
    throw createError({ statusCode: 400, message: 'bad job' })
  }

  for (const d of cleared) {
    // A walker registered but not yet launched has no agent to poke.
    if (d.agent === '(starting)') continue
    await herdrJson(['agent', 'send-keys', d.agent, 'esc']).catch(() => {})
    await herdrJson(['agent', 'send-keys', d.agent, 'esc']).catch(() => {})
  }
  return { cancelled: cleared.length > 0 }
})
