// Tear the connection down: data channel, peer connection, signaling socket.
// The peer's status stays readable afterwards (state: 'closed').
export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id')!
  const manager = usePeerManager()
  if (!manager.get(id)) throw createError({ statusCode: 404, statusMessage: 'peer not found' })
  manager.close(id)
  return manager.get(id)
})
