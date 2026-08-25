// Deny a pending pull — the requester is told, and nothing transfers.
export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id')!
  try {
    useSyncServer().deny(id)
  } catch (error) {
    if (error instanceof PullAnswerError) {
      throw createError({ statusCode: error.statusCode, statusMessage: error.message })
    }
    throw error
  }
  return { ok: true }
})
