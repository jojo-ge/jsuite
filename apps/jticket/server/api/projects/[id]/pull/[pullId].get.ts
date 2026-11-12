// Progress of one pull attempt — state, reason, and (once applied) the
// change summary the importer reads.
export default defineEventHandler((event) => {
  const ref = getRouterParam(event, 'id')!
  const pullId = getRouterParam(event, 'pullId')!
  const store = loadStore()
  const project = findByRef(store.projects, ref)
  if (!project) throw createError({ statusCode: 404, statusMessage: 'project not found' })
  const pull = useSyncPuller().get(pullId)
  if (!pull || pull.projectId !== project.id) {
    throw createError({ statusCode: 404, statusMessage: 'pull attempt not found' })
  }
  return { pull }
})
