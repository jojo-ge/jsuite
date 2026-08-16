// The dispatch picker's view of the board: every open ticket with its derived
// flags (frontier / blocked / claimed), plus epic names for grouping. Proxied
// through jAgent so the browser never needs CORS into jTicket.
export default defineEventHandler(async (event) => {
  const state = loadAgentState()
  findWorkspace(state, getRouterParam(event, 'id')!)
  const [todo, inProgress, epics] = await Promise.all([
    trackerTickets('?status=todo'),
    trackerTickets('?status=in_progress'),
    trackerEpics(),
  ])
  return { tickets: [...todo, ...inProgress], epics }
})
