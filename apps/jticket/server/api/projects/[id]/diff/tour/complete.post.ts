// A `/jdiff-tour` session's sign-off: records why it failed, if it did, so the
// Diff tab says so instead of spinning, and settles the run.
// Body: { ...target, failures?: [{ message }] }
// → { done: true, wasTracked }
export default defineEventHandler(async (event) => {
  const body = (await readBody<Record<string, unknown>>(event)) ?? {}
  return completeTour(tourContext(getRouterParam(event, 'id'), body), body.failures)
})
