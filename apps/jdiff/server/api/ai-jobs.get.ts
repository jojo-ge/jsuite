// Which review runs are currently dispatched into herdr — for one target
// (?number= or ?branch=, so a client landing on its page can resume its
// pending state) or for every target in the repo (neither param, so the list
// view can badge busy rows and show the running-jobs section).
//
// Response shapes match the old in-process job registry: `running` is a list
// of job kinds (only 'analyze' exists now), `jobs` summarises each run.
export default defineEventHandler((event) => {
  const query = getQuery(event)
  const path = resolveRepoDir(String(query.repo ?? ''))
  if (query.number || query.branch) {
    const target = resolveTarget(event)
    const dispatch = getReviewDispatch(path, target.storeKey)
    // `failures` explains a run that died out of sight (a closed herdr pane,
    // a session that never posted), so resuming shows the reason instead of
    // an empty result. `startedAt`/`pendingTools` let a reloaded page resume
    // exactly the panels the session hasn't posted yet.
    return {
      running: dispatch ? ['analyze'] : [],
      failures: loadFailures(path, target.storeKey),
      startedAt: dispatch?.startedAt ?? null,
      pendingTools: dispatch ? [...dispatch.pending] : [],
      agent: dispatch?.agent ?? null,
    }
  }
  const prs: Record<string, string[]> = {}
  const jobs = allReviewDispatches(path)
    .map((d) => {
      prs[d.number] = ['analyze']
      const waiting = REVIEW_TOOLS.filter((t) => d.pending.has(t))
      return {
        jobKind: 'analyze',
        // The storeKey, so the client can reverse it into a target (a bare
        // number for PRs, "branch/<name>" for branch reviews).
        id: d.number,
        startedAt: d.startedAt,
        lastLog: `running in herdr (agent ${d.agent}) — waiting on ${waiting.join(', ')}`,
        logCount: 0,
      }
    })
    // Longest-running first: the one most likely to be stuck reads first.
    .sort((a, b) => a.startedAt - b.startedAt)
  return { prs, jobs }
})
