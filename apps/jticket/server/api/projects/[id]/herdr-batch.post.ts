// Dispatch several tickets into ONE claude session — the board's One session
// button. A new single-pane tab in the project's workspace
// ('PROJ-n · batch · TICK-3, TICK-4 …') running the batch prompt the client
// built: each ticket's own hand-off, inlined in run order (resolveBatchPrompt).
// Not the orchestrator — no claims, no budget, no subagents. Meant for a few
// small tasks or decision tickets that don't each need a model spun up.
//
// Auto mode owns the project's AFK tickets, so a batch holding one is refused
// (409) like a single dispatch would be; an all-HITL batch is still the
// human's to run.
//
// Body: { prompt: string, tickets: string[] }  (ticket keys or ids, in run order)
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const body = await readBody<{ prompt?: string; tickets?: string[] }>(event)
  const prompt = (body?.prompt ?? '').trim()
  if (!prompt) throw createError({ statusCode: 400, statusMessage: 'prompt is required' })
  const refs = Array.isArray(body?.tickets) ? body!.tickets!.filter((k) => typeof k === 'string' && k.trim()) : []
  if (!refs.length) throw createError({ statusCode: 400, statusMessage: 'tickets is required — the keys to work, in order' })

  const store = loadStore()
  const project = findByRef(store.projects, id)
  if (!project) throw createError({ statusCode: 404, statusMessage: 'project not found' })

  const tickets = refs.map((ref) => {
    const t = findByRef(store.tickets, ref)
    if (!t) throw createError({ statusCode: 404, statusMessage: `ticket not found: ${ref}` })
    return t
  })
  if (projectAutoEnabled(store, project.id) && tickets.some((t) => !isHitl(t))) {
    throw createError({ statusCode: 409, statusMessage: 'auto mode is driving this project — turn the jButton off to batch AFK tickets by hand' })
  }
  return dispatchBatchSession(store, project, tickets, prompt)
})
