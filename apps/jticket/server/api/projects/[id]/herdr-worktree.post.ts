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
  const project = findByRef(store.projects, id)
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

  // 'PROJ-n · worktree' tab, locked and logged like every other project session.
  return dispatchProjectSession(project, 'worktree', prompt, { agent: `worktree-${project.key}` })
})
