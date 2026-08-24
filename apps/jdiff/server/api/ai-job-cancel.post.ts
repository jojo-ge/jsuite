// Stop tracking a dispatched review run. The claude session belongs to herdr,
// not jDiff, so this can't kill it outright — it sends an interrupt (esc) to
// the agent best-effort and clears the dispatch so the UI settles. The pane
// stays open in herdr for the reviewer to inspect or close themselves.
export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const path = resolveRepoDir(String(body?.repo ?? ''))
  const target = resolveTargetFromBody(body)
  const dispatch = clearReviewDispatch(path, target.storeKey)
  if (dispatch) {
    await herdrJson(['agent', 'send-keys', dispatch.agent, 'esc']).catch(() => {})
    await herdrJson(['agent', 'send-keys', dispatch.agent, 'esc']).catch(() => {})
  }
  return { cancelled: !!dispatch }
})
