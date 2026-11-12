// The briefing in front of a node: every upstream's state, the node's own
// project, and `flags` — what isn't in the expected state. Never a gate.
// ?stackOn=<nodeId> (or '' for the default branch) previews another base.
// GitHub/git facts are time-boxed: `incomplete: true` means some read
// 'unknown' — ask again shortly.
export default defineEventHandler(async (event) => {
  const store = loadStore()
  const graph = findGraph(store, getRouterParam(event, 'id'))
  const q = getQuery(event)
  const stackOn = q.stackOn === undefined ? undefined : String(q.stackOn) || null
  return graphBriefing(store, graph, String(getRouterParam(event, 'nodeId')), { stackOn })
})
