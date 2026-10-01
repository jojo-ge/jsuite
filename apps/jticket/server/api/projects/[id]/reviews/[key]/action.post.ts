// The Review tab's recovery buttons, passed through to jReview:
//   { action: 'retry-reviewer', n }  — (re-)dispatch reviewer n into herdr
//   { action: 'skip-reviewer', n }   — give up on it so triage can go ahead
//   { action: 'retry-triage' }       — (re-)dispatch the triage session
// Returns the review.
const ROUTES = {
  'retry-reviewer': (n: number) => `reviewers/${n}/dispatch`,
  'skip-reviewer': (n: number) => `reviewers/${n}/skip`,
  'retry-triage': () => 'triage/dispatch',
} as const

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const body = (await readBody<{ action?: string; n?: number }>(event)) ?? {}
  const store = loadStore()
  const project = store.projects.find((p) => p.id === id || p.key === id)
  if (!project) throw createError({ statusCode: 404, statusMessage: 'project not found' })

  const route = ROUTES[body.action as keyof typeof ROUTES]
  if (!route) throw createError({ statusCode: 400, statusMessage: `unknown action: ${body.action}` })
  const n = Number(body.n)
  if (body.action !== 'retry-triage' && !(Number.isInteger(n) && n >= 1)) {
    throw createError({ statusCode: 400, statusMessage: 'n must be a reviewer slot' })
  }

  const review = await projectReview(project.key, String(getRouterParam(event, 'key')))
  // A dispatch blocks until claude is up in its pane.
  return jreviewFetch<JreviewFull>(`/api/reviews/${encodeURIComponent(review.key)}/${route(n)}`, {
    method: 'POST',
    timeout: 60_000,
  })
})
