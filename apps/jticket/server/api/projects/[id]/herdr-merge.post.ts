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
  if (project.auto?.enabled) {
    throw createError({ statusCode: 409, statusMessage: 'auto mode is driving this project — it runs its own merge sweeps' })
  }
  return dispatchMergeSession(project, prompt)
})
