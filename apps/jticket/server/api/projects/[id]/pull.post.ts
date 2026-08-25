// The importer's Sync click: start one pull attempt for this shared project.
// Returns immediately with the attempt; the client polls
// GET /api/projects/:id/pull/:pullId until a terminal state.
export default defineEventHandler((event) => {
  const ref = getRouterParam(event, 'id')!
  try {
    const pull = useSyncPuller().start(ref)
    setResponseStatus(event, 201)
    return { pull }
  } catch (error) {
    if (error instanceof PullStartError) {
      throw createError({ statusCode: error.statusCode, statusMessage: error.message })
    }
    throw error
  }
})
