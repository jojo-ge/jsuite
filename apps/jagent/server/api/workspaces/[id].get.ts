export default defineEventHandler((event) => {
  const state = loadAgentState()
  return findWorkspace(state, getRouterParam(event, 'id')!)
})
