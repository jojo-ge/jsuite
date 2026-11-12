// The Review tab's recovery buttons, on the review engine:
//   { action: 'retry-reviewer', n }  — (re-)dispatch reviewer n into herdr
//   { action: 'skip-reviewer', n }   — give up on it so triage can go ahead
//   { action: 'retry-triage' }       — (re-)dispatch the triage session
// Returns the review.
const ACTIONS = {
  'retry-reviewer': (key: string, n: number) => retryReviewer(key, n),
  'skip-reviewer': (key: string, n: number) => skipReviewer(key, n),
  'retry-triage': (key: string) => retryTriage(key),
} as const

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const body = (await readBody<{ action?: string; n?: number }>(event)) ?? {}
  const store = loadStore()
  const project = findByRef(store.projects, id)
  if (!project) throw createError({ statusCode: 404, statusMessage: 'project not found' })

  const action = ACTIONS[body.action as keyof typeof ACTIONS]
  if (!action) throw createError({ statusCode: 400, statusMessage: `unknown action: ${body.action}` })
  const n = Number(body.n)
  if (body.action !== 'retry-triage' && !(Number.isInteger(n) && n >= 1)) {
    throw createError({ statusCode: 400, statusMessage: 'n must be a reviewer slot' })
  }

  const review = await projectReview(project.key, String(getRouterParam(event, 'key')))
  // A dispatch blocks until claude is up in its pane.
  return action(review.key, n)
})
