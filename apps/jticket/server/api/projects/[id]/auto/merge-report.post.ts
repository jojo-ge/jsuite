// The auto loop's merge sweep reporting that it's finished. The loop's merge
// phase waits on this, not on PR statuses: once it lands, the loop moves on
// if every PR merged, or pauses with the reasons if any didn't.
//
// Body: { unmerged?: [{ pr: string, reason: string }] }   // [] = all landed
//
// 409 when no auto-loop sweep is waiting on a report. Returns the loop state.
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const body = (await readBody(event)) ?? {}
  const store = loadStore()
  const project = store.projects.find((p) => p.id === id || p.key === id)
  if (!project) throw createError({ statusCode: 404, statusMessage: 'project not found' })

  const auto = recordMergeReport(project, body)
  saveStore(store)
  void advanceAutoLoop(project.id)
  return auto
})
