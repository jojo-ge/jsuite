// The integration branch measured against its base — the Overview card's
// stacking line and the graph briefing: the base, ahead/behind, unpushed
// commits, whether the base still exists and the upstream looks merged, what
// Sync would do, and the slice's size. integrationBranchState() in
// server/utils/integrationBase.ts; never fetches, ?force=1 re-asks origin and gh.
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const store = loadStore()
  const project = findByRef(store.projects, id)
  if (!project) throw createError({ statusCode: 404, statusMessage: 'project not found' })
  return integrationBranchState(store, project, { force: !!getQuery(event).force })
})
