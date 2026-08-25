// The importer's Sync click: start one pull attempt for this shared project.
// Returns immediately with the attempt; the client polls
// GET /api/projects/:id/pull/:pullId until a terminal state.
//
// The puller is imported lazily (no bare auto-imported references — those
// would inline the chain): it ends at node-datachannel's native addon, and
// where that can't resolve the click should get an honest 503, not a 500.
export default defineEventHandler(async (event) => {
  const ref = getRouterParam(event, 'id')!
  const mod = await import('../../../utils/syncPull').catch(() => null)
  if (!mod) {
    throw createError({ statusCode: 503, statusMessage: 'sync is unavailable — the WebRTC addon failed to load' })
  }
  try {
    const pull = mod.useSyncPuller().start(ref)
    setResponseStatus(event, 201)
    return { pull }
  } catch (error) {
    if (error instanceof mod.PullStartError) {
      throw createError({ statusCode: error.statusCode, statusMessage: error.message })
    }
    throw error
  }
})
