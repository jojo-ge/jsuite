// Where a `/jdiff-tour` session hands its tour back. Saved as the target's
// detail tour (server/utils/tourStore.ts) once it passes cleanTour; settles
// the run.
// Body: { ...target, artifact: { overview, stops: [{ path, side, line, endLine, title, note }] } }
// → { saved: 'tour', key, stops, createdAt }
export default defineEventHandler(async (event) => {
  const body = (await readBody<Record<string, unknown>>(event)) ?? {}
  return saveTourArtifact(tourContext(getRouterParam(event, 'id'), body), body.artifact)
})
