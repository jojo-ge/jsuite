// Dispatch the merge sweep into Herdr: a NEW single-pane tab in the project's
// workspace ('PROJ-n · merge'), running claude with the merge prompt — land
// every open local PR on the integration branch, rebasing through conflicts.
// Created --no-focus; the "go to" button is how you watch it.
//
// Body: { prompt: string }  (built by the client, same text the copy button copies)
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const body = await readBody<{ prompt?: string }>(event)
  const prompt = (body?.prompt ?? '').trim()
  if (!prompt) throw createError({ statusCode: 400, statusMessage: 'prompt is required' })

  const store = loadStore()
  const project = store.projects.find((p) => p.id === id || p.key === id)
  if (!project) throw createError({ statusCode: 404, statusMessage: 'project not found' })
  const cwd = resolveRepoDir(project.repo)

  const { workspaceId, freshTab } = await ensureHerdrWorkspace(project.title, cwd)
  // A fresh workspace's root tab becomes the merge tab; otherwise cut a new one.
  let tabId: string, paneId: string
  if (freshTab) {
    await herdrJson(['tab', 'rename', freshTab.tabId, `${project.key} · merge`])
    ;({ tabId, paneId } = freshTab)
  } else {
    ;({ tabId, paneId } = await createJobTab(workspaceId, `${project.key} · merge`, cwd))
  }
  await renamePane(paneId, `${project.key} · merge`)
  const agent = await startClaudeIn(paneId, `merge-${project.key}`, prompt)

  return { workspaceId, tabId, paneId, agent, project: project.key }
})
