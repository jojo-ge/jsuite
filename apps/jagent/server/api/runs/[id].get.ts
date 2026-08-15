export default defineEventHandler((event) => {
  const state = loadAgentState()
  return findRun(state, getRouterParam(event, 'id')!)
})
