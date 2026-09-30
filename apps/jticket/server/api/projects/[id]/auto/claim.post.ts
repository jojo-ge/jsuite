// The orchestrator of an orchestrated auto loop taking one ticket for a
// subagent. The budget is enforced here: a claim past it is refused.
//
// Body: { ticket: "TICK-7" }
//
// Returns { ticket, title, branch, integrationBranch, prompt, again, inFlight,
// budget } — `prompt` is what the implementer subagent is given. Claiming a
// ticket already in flight hands the same claim back (`again: true`).
// 409 with data.wait = true while the budget is full (finish one first);
// other 409s / 404 mean the ticket isn't claimable at all.
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const body = (await readBody<{ ticket?: unknown }>(event)) ?? {}
  const key = typeof body.ticket === 'string' ? body.ticket.trim() : ''
  if (!key) throw createError({ statusCode: 400, statusMessage: 'send {"ticket": "TICK-n"}' })
  const project = loadStore().projects.find((p) => p.id === id || p.key === id)
  if (!project) throw createError({ statusCode: 404, statusMessage: 'project not found' })
  return claimForOrchestrator(project.id, key)
})
