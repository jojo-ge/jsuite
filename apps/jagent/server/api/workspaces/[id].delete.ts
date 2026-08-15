export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id')!
  return mutateAgentState((s) => {
    findWorkspace(s, id)
    if (s.runs.some((r) => r.workspaceId === id && isLive(r))) {
      throw createError({ statusCode: 409, message: 'workspace has live runs — discard or accept them first' })
    }
    s.workspaces = s.workspaces.filter((w) => w.id !== id)
    s.runs = s.runs.filter((r) => r.workspaceId !== id)
    return { ok: true }
  })
})
