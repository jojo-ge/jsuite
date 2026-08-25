import { parseWireMessage } from '~~/server/utils/syncWire'

// Send one wire message over a probe channel. Only well-formed protocol
// messages go out: the probe is a diagnostic for the real protocol, not a
// tunnel for arbitrary bytes.
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') as string
  const body = await readBody(event)
  const message = parseWireMessage(JSON.stringify(body?.message ?? null))
  if (!message) throw createError({ statusCode: 400, statusMessage: 'message must be a valid sync wire message' })
  try {
    await probeSend(id, message)
    return { ok: true }
  } catch (error) {
    throw asProbeError(error)
  }
})
