// Read-only "what is this path?" (?path=…), for the project form's live check.
// Answers 200 with ok:false for a bad path rather than erroring — half a typed
// path is a normal state, not a failure — and never writes to the store.
export default defineEventHandler(async (event) => {
  return await probeRepo(String(getQuery(event).path ?? ''))
})
