// Dial the other jTicket instance: join the relay room and start the WebRTC
// handshake. Returns { id } immediately — poll GET /api/sync/peer/:id.
export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { relayUrl, roomId, secret, initiator, iceServers } = body ?? {}
  if (typeof relayUrl !== 'string' || !relayUrl) {
    throw createError({ statusCode: 400, statusMessage: 'relayUrl is required' })
  }
  if (typeof roomId !== 'string' || !roomId) {
    throw createError({ statusCode: 400, statusMessage: 'roomId is required' })
  }
  if (typeof secret !== 'string' || !secret) {
    throw createError({ statusCode: 400, statusMessage: 'secret is required' })
  }
  if (typeof initiator !== 'boolean') {
    throw createError({ statusCode: 400, statusMessage: 'initiator (boolean) is required' })
  }
  if (iceServers !== undefined && (!Array.isArray(iceServers) || iceServers.some((s) => typeof s !== 'string'))) {
    throw createError({ statusCode: 400, statusMessage: 'iceServers must be an array of strings' })
  }
  return usePeerManager().dial({
    relayUrl,
    roomId,
    secret,
    initiator,
    ...(Array.isArray(iceServers) ? { iceServers } : {}),
  })
})
