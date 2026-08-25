// Leave a probe channel.
export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id') as string
  try {
    closeProbe(id)
    return { ok: true }
  } catch (error) {
    throw asProbeError(error)
  }
})
