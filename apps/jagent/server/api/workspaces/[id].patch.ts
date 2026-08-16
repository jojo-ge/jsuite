export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const body = await readBody<Record<string, unknown>>(event)
  const ws = mutateAgentState((s) => {
    const w = findWorkspace(s, id)
    if (typeof body.name === 'string' && body.name.trim()) w.name = body.name.trim()
    if (typeof body.base === 'string' && body.base.trim()) w.base = body.base.trim()
    if (typeof body.setup === 'string') w.setup = body.setup.trim()
    if (typeof body.fleet === 'boolean') w.fleet = body.fleet
    if (Number.isInteger(body.fleetSlots) && (body.fleetSlots as number) > 0) w.fleetSlots = body.fleetSlots as number
    if (Number.isInteger(body.maxWorktrees) && (body.maxWorktrees as number) > 0) w.maxWorktrees = body.maxWorktrees as number
    if (Array.isArray(body.queue)) {
      // Replace wholesale — the client sends the whole reordered queue.
      // Re-queueing an entry clears its recorded dispatch error.
      w.queue = (body.queue as any[])
        .map((e) => ({ key: String(e?.key ?? '').trim(), force: !!e?.force }))
        .filter((e) => e.key)
    }
    w.updatedAt = nowIso()
    return w
  })
  void fleetTick()
  return ws
})
