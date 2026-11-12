// Where this review project's findings would go back to — the Review tab asks
// before it offers Send back. { offered, why, graph, target, candidates,
// ticketType }: offered only for a review that sits directly after a build in
// a graph; `target` is null (with `why`) when several builds lead into it and
// none is the reviewed PR's — `?to=PROJ-n` picks one.
export default defineEventHandler((event) => {
  const store = loadStore()
  const project = findByRef(store.projects, getRouterParam(event, 'id'))
  if (!project) throw createError({ statusCode: 404, statusMessage: 'project not found' })
  const to = getQuery(event).to
  const { rule: _rule, ...place } = sendBackPlace(store, project, typeof to === 'string' ? to : undefined)
  return place
})
