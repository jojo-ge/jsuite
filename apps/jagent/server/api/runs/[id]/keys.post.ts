export default defineEventHandler(async (event) => {
  const state = loadAgentState()
  const r = findRun(state, getRouterParam(event, 'id')!)
  const body = await readBody<{ text?: string; key?: string }>(event)
  if (typeof body?.text === 'string' && body.text.length) await tmuxSendText(r.session, body.text)
  if (typeof body?.key === 'string' && body.key) await tmuxSendKey(r.session, body.key)
  return { ok: true }
})
