// Which runs are currently dispatched into herdr — for one target (?number=
// or ?branch=, so a client landing on its page can resume its pending state)
// or for every target in the repo (neither param, so the list view can badge
// busy rows and show the running-jobs section).
//
// The analyze run keeps its legacy top-level fields (`startedAt`,
// `pendingTools`, `agent`); every live job — analyze, detail, chains-scope,
// chain:<slug> — also appears in `byJob`, and `running` lists their ids.
export default defineEventHandler((event) => {
  const query = getQuery(event)
  const path = resolveRepoDir(String(query.repo ?? ''))
  if (query.number || query.branch) {
    const target = resolveTarget(event)
    const all = targetDispatches(path, target.storeKey)
    const analyze = all.find((d) => d.job === 'analyze') ?? null
    const byJob: Record<string, { startedAt: number; agent: string; pendingTools: string[] }> = {}
    for (const d of all) {
      byJob[d.job] = { startedAt: d.startedAt, agent: d.agent, pendingTools: [...d.pending] }
    }
    // `failures` explains a run that died out of sight (a closed herdr pane,
    // a session that never posted), so resuming shows the reason instead of
    // an empty result. `startedAt`/`pendingTools` let a reloaded page resume
    // exactly the panels the session hasn't posted yet.
    return {
      running: all.map((d) => d.job),
      failures: loadFailures(path, target.storeKey),
      startedAt: analyze?.startedAt ?? null,
      pendingTools: analyze ? [...analyze.pending] : [],
      agent: analyze?.agent ?? null,
      byJob,
    }
  }
  const prs: Record<string, string[]> = {}
  const jobs = allReviewDispatches(path)
    .map((d) => {
      ;(prs[d.number] ??= []).push(d.job)
      return {
        jobKind: d.job,
        // The storeKey, so the client can reverse it into a target (a bare
        // number for PRs, "branch/<name>" for branch reviews).
        id: d.number,
        startedAt: d.startedAt,
        lastLog: `running in herdr (agent ${d.agent}) — waiting on ${[...d.pending].join(', ')}`,
        logCount: 0,
      }
    })
    // Longest-running first: the one most likely to be stuck reads first.
    .sort((a, b) => a.startedAt - b.startedAt)
  return { prs, jobs }
})
