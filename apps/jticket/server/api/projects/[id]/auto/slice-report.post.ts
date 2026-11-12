// The run plan's slice report session reporting that it's finished: the
// loop waits on this between steps, then starts the implement step whose
// sessions read the report first.
//
// Body: { doc: "DOC-n" }   // the report it wrote — must be one of this project's docs
//
// The doc gets the 'slice' label, and its document the 'slice-report' tag
// (its kind — which files it out of the document library). 409 when no report is being waited on; 400
// for a doc that isn't the project's. Returns the loop state.
import { SLICE_REPORT_TAG } from '../../../../../app/utils/documentLibrary'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const body = (await readBody(event)) ?? {}
  const store = loadStore()
  const project = findByRef(store.projects, id)
  if (!project) throw createError({ statusCode: 404, statusMessage: 'project not found' })

  const auto = recordSliceReport(store, project, body)
  saveStore(store)
  const doc = findByRef(store.docs, auto.sliceDoc)
  if (doc?.documentKey) await setDocTags(doc.documentKey, [SLICE_REPORT_TAG])
  void advanceAutoLoop(project.id)
  return auto
})
