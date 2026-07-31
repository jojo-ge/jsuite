import type { AiJob, AiJobKind } from '../utils/aiJobs'

// Which claude jobs are currently running — for one target (?number= or
// ?branch=, so a client landing on its page can re-attach to the streams) or
// for every target in the repo (neither param, so the list view can badge
// busy rows and show the running-jobs section).
export default defineEventHandler((event) => {
  const query = getQuery(event)
  const path = resolveRepoDir(String(query.repo ?? ''))
  if (query.number || query.branch) {
    const target = resolveTarget(event)
    // `failures` explains a run that died while nothing was attached to its
    // stream, so re-attaching shows the reason instead of an empty result.
    return {
      running: runningAiJobs(path, target.storeKey),
      failures: recentAiFailures(path, target.storeKey),
    }
  }
  const prs: Record<string, AiJobKind[]> = {}
  const jobs = allRunningAiJobs(path).map((job) => {
    ;(prs[job.number] ??= []).push(job.jobKind)
    return summarise(job)
  })
  // Longest-running first: the one most likely to be stuck reads first.
  jobs.sort((a, b) => a.startedAt - b.startedAt)
  return { prs, jobs }
})

// What a client that never watched this run needs to describe it: the target
// it belongs to, when it started, and the last thing it said.
function summarise(job: AiJob) {
  let lastLog = ''
  let logCount = 0
  for (const e of job.events) {
    if (e.kind !== 'log') continue
    logCount++
    lastLog = String(e.text ?? '')
  }
  return {
    jobKind: job.jobKind,
    // The storeKey, so the client can reverse it into a target (a bare number
    // for PRs, "branch/<name>" for branch reviews).
    id: job.number,
    startedAt: job.startedAt,
    lastLog,
    logCount,
  }
}
