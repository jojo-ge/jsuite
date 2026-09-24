// The jButton: turn auto mode on or off, ask it to stop at the end of the
// loop in progress, or retry a paused step.
//
// Body: { enabled?: boolean, stopRequested?: boolean, retry?: boolean }
//   enabled: true   — start looping (409 with the reason when the project
//                     can't: not standard mode, no repo, no integration
//                     branch, or shared with us by someone else)
//   enabled: false  — off now; sessions already running in herdr carry on
//   stopRequested   — true = finish the loop in progress, then turn off;
//                     false = keep going after all
//   retry           — clear a pause and re-run the step it stopped on
//
// Returns the project's loop state. The loop itself is advanced by
// server/plugins/autoLoop.ts; enabling nudges the first tick straight away.
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const body = (await readBody<{ enabled?: unknown; stopRequested?: unknown; retry?: unknown }>(event)) ?? {}
  const store = loadStore()
  const project = store.projects.find((p) => p.id === id || p.key === id)
  if (!project) throw createError({ statusCode: 404, statusMessage: 'project not found' })

  const enabling = body.enabled === true && !project.auto?.enabled
  if (enabling) {
    const blocked = autoModeBlocker(store, project)
    if (blocked) throw createError({ statusCode: 409, statusMessage: blocked })
  }

  // Stop and retry only mean something to a running loop; don't mint loop
  // state on a project that never had one.
  if (!enabling && !project.auto?.enabled) {
    if (body.enabled === false) return project.auto ?? null
    throw createError({ statusCode: 409, statusMessage: `auto mode is off for ${project.key} — press the jButton first` })
  }

  const auto = setAutoMode(store, project, {
    enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
    stopRequested: typeof body.stopRequested === 'boolean' ? body.stopRequested : undefined,
    retry: body.retry === true,
  })
  saveStore(store)

  if (enabling || body.retry === true) void advanceAutoLoop(project.id)
  return auto
})
