// Build tour: dispatch one `/jdiff-tour` session (Opus) into the project's
// herdr workspace, in its own --no-focus 'PROJ-n · tour …' tab, over the
// target's exact commits. A run already live for the target is attached to.
// Body: the target ({ pr } | { gh } | { head, base? } | {}).
// → { job: { startedAt, agent }, attached }
export default defineEventHandler(async (event) => {
  const body = (await readBody<Record<string, unknown>>(event)) ?? {}
  const { job, attached } = await buildTour(tourContext(getRouterParam(event, 'id'), body))
  return { job: { startedAt: job.startedAt, agent: job.agent }, attached }
})
