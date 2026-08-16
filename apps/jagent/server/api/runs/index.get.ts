export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const state = loadAgentState()
  let runs = state.runs
  if (q.workspaceId) runs = runs.filter((r) => r.workspaceId === q.workspaceId)
  // The rail promises a live diffstat for every run, not just the open one —
  // refresh the live ones inline (numstat is cheap; run counts are small).
  const fresh = await Promise.all(
    runs.map((r) => {
      if (!isLive(r) || r.status === 'starting') return r
      const ws = state.workspaces.find((w) => w.id === r.workspaceId)
      return ws ? refreshDiffStat(r, ws.base) : r
    }),
  )
  return fresh
})
