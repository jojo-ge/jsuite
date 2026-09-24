// Edit a codebase's settings (?path=…). Today that is its hand-off prompt
// overrides — the layer between a project's own and the global defaults —
// merged per kind exactly like PATCH /api/prompts:
//   { prompts: { 'standard:local': '…' } }  sets one kind
//   { prompts: { 'standard:local': '' } }   drops it back to the global default
// The worktree guide has its own endpoint (/api/repos/worktree): an agent
// writes it, not this form.
export default defineEventHandler(async (event) => {
  const path = resolveRepoParam(loadStore(), getQuery(event).path)
  if (!path) throw createError({ statusCode: 400, statusMessage: 'missing ?path=' })
  const body = await readBody<{ prompts?: unknown }>(event)
  if (body?.prompts === undefined) throw createError({ statusCode: 400, statusMessage: 'prompts is required' })

  const store = loadStore()
  const repo = findKnownRepo(store, path)
  if (!repo) throw createError({ statusCode: 404, statusMessage: `not a known codebase: ${path}` })
  repo.prompts = mergePromptOverrides(repo.prompts, body.prompts)
  saveStore(store)
  return { path: repo.path, prompts: repo.prompts }
})
