// Deletes the map only. Domain documents live in the shared pool and stay —
// same rule as jGrilling debriefs.
export default defineEventHandler(async (event) => {
  const key = String(getRouterParam(event, 'key'))
  await deleteMap(key)
  return { ok: true }
})
