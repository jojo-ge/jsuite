// The probe channel's state, plus every wire message it has received.
export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id') as string
  try {
    return probeStatus(id)
  } catch (error) {
    throw asProbeError(error)
  }
})
