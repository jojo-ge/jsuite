// The auto loop's outcome report session reporting that it's finished: the
// project's last phase waits on this, then auto mode turns off as complete.
//
// Body: { doc: "DOC-n" }   // the report it wrote — must be one of this project's docs
//
// The doc becomes the project's one 'outcome'-labelled doc (the label moves
// off any older report). 409 when no report is being waited on; 400 for a doc
// that isn't the project's. Returns the loop state.
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const body = (await readBody(event)) ?? {}
  const store = loadStore()
  const project = store.projects.find((p) => p.id === id || p.key === id)
  if (!project) throw createError({ statusCode: 404, statusMessage: 'project not found' })

  const auto = recordOutcomeReport(store, project, body)
  saveStore(store)
  void advanceAutoLoop(project.id)
  return auto
})
