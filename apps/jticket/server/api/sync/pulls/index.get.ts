// The serving side's pending pull approvals — what the project page's
// approval banner polls. In-memory: a request either gets answered or
// expires; nothing here survives a restart (the importer just asks again).
export default defineEventHandler(() => {
  return { pulls: useSyncServer().pending() }
})
