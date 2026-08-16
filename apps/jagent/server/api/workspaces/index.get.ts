export default defineEventHandler(() => {
  const state = loadAgentState()
  return state.workspaces.map((ws) => ({
    ...ws,
    live: state.runs.filter((r) => r.workspaceId === ws.id && isLive(r)).length,
    reviews: state.runs.filter((r) => r.workspaceId === ws.id && r.status === 'needs_review').length,
  }))
})
