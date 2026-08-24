// Close the herdr tabs a project's dispatches left behind: every 'KEY' /
// 'KEY · …' tab in the project's workspace (ticket grids, merge sweeps, HITL
// tabs). Tabs the human opened in that workspace themselves are never touched;
// when the project's tabs are all the workspace has, the workspace itself is
// closed so no empty shell lingers. Tabs whose agent is still working or
// blocked make this a 409 unless { force: true } — closing a pane kills
// whatever runs in it.
//
// Body: { force?: boolean }
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const body = await readBody<{ force?: boolean }>(event).catch(() => ({}) as { force?: boolean })

  const store = loadStore()
  const project = store.projects.find((p) => p.id === id || p.key === id)
  if (!project) throw createError({ statusCode: 404, statusMessage: 'project not found' })

  const list = await herdrJson(['workspace', 'list'])
  const workspace = (list?.result?.workspaces ?? []).find((w: any) => w.label === project.title)
  if (!workspace) throw createError({ statusCode: 404, statusMessage: `no herdr workspace for ${project.title}` })

  const tabList = await herdrJson(['tab', 'list', '--workspace', workspace.workspace_id])
  const tabs: any[] = tabList?.result?.tabs ?? []
  const owned = tabs.filter((t) => {
    const label = String(t.label ?? '')
    return label === project.key || label.startsWith(`${project.key} · `)
  })
  if (!owned.length) throw createError({ statusCode: 404, statusMessage: `no ${project.key} tabs to clean up` })

  const busy = owned.filter((t) => t.agent_status === 'working' || t.agent_status === 'blocked')
  if (busy.length && !body?.force) {
    throw createError({
      statusCode: 409,
      statusMessage: `agents are still busy in: ${busy.map((t) => t.label).join(', ')}`,
    })
  }

  let workspaceClosed = false
  if (owned.length === tabs.length) {
    await herdrJson(['workspace', 'close', workspace.workspace_id])
    workspaceClosed = true
  } else {
    for (const t of owned) await herdrJson(['tab', 'close', t.tab_id])
  }
  invalidateHerdrState()
  return { closed: owned.length, workspaceClosed, project: project.key }
})
