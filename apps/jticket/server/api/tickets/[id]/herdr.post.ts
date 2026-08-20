// Dispatch a ticket's hand-off prompt straight into Herdr instead of the
// clipboard: workspace = the project (title, cwd = repo), pane = a fresh shell
// packed up to four per 'PROJ-n' tab, agent = claude named after the ticket.
// Nothing is focused — the work starts in the background.
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
  const project = store.projects.find((p) => p.id === ticket.projectId)
  if (!project) throw createError({ statusCode: 400, statusMessage: `${ticket.key} has no project — herdr workspaces are per-project` })
  const cwd = resolveRepoDir(project.repo)

  const { workspaceId, freshTab } = await ensureHerdrWorkspace(project.title, cwd)
  let tabId: string, paneId: string
  if (body?.ownTab) {
    const label = `${project.key} · ${ticket.key}`
    if (freshTab) {
      await herdrJson(['tab', 'rename', freshTab.tabId, label])
      ;({ tabId, paneId } = freshTab)
    } else {
      ;({ tabId, paneId } = await createJobTab(workspaceId, label, cwd))
    }
  } else {
    ;({ tabId, paneId } = await acquireTicketPane(workspaceId, project.key, cwd, freshTab))
  }
  const agent = await startClaudeIn(paneId, ticket.key, prompt)

  return { workspaceId, tabId, paneId, agent, ticket: ticket.key }
})
