// Join a share room by hand and watch what arrives — the connectivity probe
// behind the two-instance harness (and a way to check a relay is really
// working). Returns { id } immediately; poll GET /api/sync/channel/:id.
export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { roomId, secret } = body ?? {}
  if (typeof roomId !== 'string' || !roomId) {
    throw createError({ statusCode: 400, statusMessage: 'roomId is required' })
  }
  if (typeof secret !== 'string' || !secret) {
    throw createError({ statusCode: 400, statusMessage: 'secret is required' })
  }
  try {
    return openProbe(roomId, secret)
  } catch (error) {
    throw asProbeError(error)
  }
})
