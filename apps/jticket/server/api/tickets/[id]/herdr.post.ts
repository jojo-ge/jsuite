// Dispatch a ticket's hand-off prompt straight into Herdr instead of the
// clipboard: workspace = the project (title, cwd = repo), pane = a fresh shell
// packed up to four per 'PROJ-n' tab, agent = claude named after the ticket.
// Nothing is focused — the work starts in the background. The work itself is
// dispatchTicketSession (server/utils/herdrDispatch.ts), shared with the auto
// loop — which is why a project in auto mode refuses hand dispatches of AFK
// tickets (409).
//
// The prompt itself comes from the client (it owns the prompt-target picker
// and has already cut the ticket branch, same as the copy button).
//
// Body: { prompt: string, ownTab?: boolean }
//   ownTab — give the ticket its own single-pane tab ('PROJ-n · TICK-m')
//   instead of pane-packing. Used for HITL tickets: work that will stop and
//   ask for the human deserves a tab of its own, not a quarter of a grid.
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const body = await readBody<{ prompt?: string; ownTab?: boolean }>(event)
  const prompt = (body?.prompt ?? '').trim()
  if (!prompt) throw createError({ statusCode: 400, statusMessage: 'prompt is required' })

  const store = loadStore()
  const ticket = store.tickets.find((t) => t.id === id || t.key === id)
  if (!ticket) throw createError({ statusCode: 404, statusMessage: 'ticket not found' })
  // Auto mode owns every AFK ticket of its project; HITL tickets are still the
  // human's to dispatch — the loop never does.
  if (projectAutoEnabled(store, ticket.projectId) && !isHitl(ticket)) {
    throw createError({ statusCode: 409, statusMessage: 'auto mode is driving this project — turn the jButton off to dispatch AFK tickets by hand' })
  }
  return dispatchTicketSession(store, ticket, prompt, { ownTab: !!body?.ownTab })
})
