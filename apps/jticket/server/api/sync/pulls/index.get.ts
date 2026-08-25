// The serving side's pending pull approvals — what the project page's
// approval banner polls. In-memory: a request either gets answered or
// expires; nothing here survives a restart (the importer just asks again).
//
// Lazy import with an empty fallback: the chain ends at node-datachannel's
// native addon, and a build running where it can't resolve should poll to
// "nothing pending", not a 500 on every project page.
export default defineEventHandler(async () => {
  try {
    const { useSyncServer } = await import('../../../utils/syncServe')
    return { pulls: useSyncServer().pending() }
  } catch {
    return { pulls: [] }
  }
})
