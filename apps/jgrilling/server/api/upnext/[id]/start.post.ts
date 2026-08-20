/**
 * Start a grilling ticket: dispatch it into herdr through jTicket's own
 * dispatch endpoint, with a prompt that routes the interview back through
 * this app (the j-grilling skill). HITL work gets its own tab, so ownTab
 * is always set — same as jTicket's /next page does for HITL rows.
 */
export default defineEventHandler(async (event) => {
  const id = String(getRouterParam(event, 'id'))

  let ticket: any
  try {
    ticket = await $fetch<any>(jticketUrl(`/api/tickets/${id}`), { timeout: 3000 })
  } catch {
    throw createError({ statusCode: 502, message: 'jTicket is not reachable' })
  }
  if (!ticket.projectId) {
    throw createError({ statusCode: 400, message: `${ticket.key} has no project — herdr workspaces are per-project` })
  }
  const project = await $fetch<any>(jticketUrl(`/api/projects/${ticket.projectId}`), { timeout: 3000 })

  // Same mode split as jTicket's /next page: wayfinder tickets are worked via
  // /jwayfinder, everything else via /jimplement — plus the grilling routing.
  const base = project.mode === 'wayfinder' ? `/jwayfinder ${ticket.key}` : `/jimplement ${ticket.key}`
  const prompt =
    `${base} — a HITL grilling ticket. Run the interview through /j-grilling: ` +
    `post each question to the jGrilling room and monitor the session file for the answer — ` +
    `don't ask in the terminal. No branch, no PR.`

  try {
    return await $fetch<{ agent: string; tabId: string }>(jticketUrl(`/api/tickets/${ticket.id}/herdr`), {
      method: 'POST',
      body: { prompt, ownTab: true },
    })
  } catch (err: any) {
    throw createError({
      statusCode: 502,
      message: String(err.data?.statusMessage ?? err.data?.message ?? err.message ?? 'herdr dispatch failed').slice(0, 300),
    })
  }
})
