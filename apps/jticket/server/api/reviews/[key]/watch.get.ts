import { watch, mkdirSync } from 'node:fs'
import { appDataDir } from '@jsuite/data'

/**
 * SSE: the live review. Pushes immediately and again whenever its file in
 * .data/jreview changes — reviewer documents landing, triage dispatch, the
 * findings POST — so the room updates with no polling. The file is the only
 * source of truth; this endpoint just mirrors it.
 */
export default defineEventHandler(async (event) => {
  const key = sanitizeReviewKey(getRouterParam(event, 'key'))
  if (!(await readReview(key))) throw createError({ statusCode: 404, message: `No such review: ${key}` })

  const stream = createEventStream(event)
  let closed = false
  const push = async () => {
    if (closed) return
    const review = await readReview(key)
    if (!review || closed) return
    try {
      await stream.push(JSON.stringify(review))
    } catch {
      // The client went away mid-push; onClosed tears the watcher down.
    }
  }

  // Watch the directory, not the file — writes replace it via rename.
  const dir = appDataDir('jreview')
  mkdirSync(dir, { recursive: true })
  let timer: ReturnType<typeof setTimeout> | null = null
  const watcher = watch(dir, (_evt, filename) => {
    if (filename !== `${key}.json`) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(push, 100)
  })
  stream.onClosed(() => {
    closed = true
    watcher.close()
    if (timer) clearTimeout(timer)
  })

  // Initial push must land after send() has flushed the response headers.
  setImmediate(push)
  return stream.send()
})
