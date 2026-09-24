// Dispatch the integration branch's connect prompt into Herdr: a single-pane
// 'PROJ-n · worktree' tab in the project's workspace, running claude with the
// 'worktree:connect' prompt — check the branch out in a worktree the
// codebase's way, set it up, and POST the link back. Created --no-focus.
//
// Refused (409) until the codebase has a worktree guide: the connect prompt's
// whole job is to follow it. The kickoff lives on codebase settings.
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
  if (!project.integrationBranch.trim()) {
    throw createError({ statusCode: 400, statusMessage: `${project.key} has no integration branch to connect` })
  }
  if (!findKnownRepo(store, cwd)?.worktreeGuide) {
    throw createError({
      statusCode: 409,
      statusMessage: "this codebase has no worktree guide yet — run its worktree kickoff from codebase settings first",
    })
  }

  const label = `${project.key} · worktree`
  const { workspaceId, freshTab } = await ensureHerdrWorkspace(project.title, cwd)
  let tabId: string, paneId: string
  if (freshTab) {
    await herdrJson(['tab', 'rename', freshTab.tabId, label])
    ;({ tabId, paneId } = freshTab)
  } else {
    ;({ tabId, paneId } = await createJobTab(workspaceId, label, cwd))
  }
  await renamePane(paneId, label)
  const agent = await startClaudeIn(paneId, `worktree-${project.key}`, prompt)

  return { workspaceId, tabId, paneId, agent, project: project.key }
})
