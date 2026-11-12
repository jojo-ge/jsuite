// Move on into a node. Body: { note?, stackOn? }. Always works — it starts
// nothing: creates the node's project if it is still proposed, records the
// stacking choice, and stamps enteredAt with the briefing shown.
// Returns { graph, node, project, created, briefing, flags }.
export default defineEventHandler(async (event) => {
  const body = (await readBody(event)) ?? {}
  return enterGraphNode(String(getRouterParam(event, 'id')), String(getRouterParam(event, 'nodeId')), body)
})
