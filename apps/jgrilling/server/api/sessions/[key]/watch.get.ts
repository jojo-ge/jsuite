import { watch } from 'node:fs'
import { appDataDir } from '@jsuite/data'

/**
 * SSE: the live session. Pushes the full session JSON immediately and again
 * whenever its file in .data/jgrilling changes — that's how the UI sees the
 * interviewer's next question the moment it lands, with no polling. The
 * session file is the single source of truth; this endpoint only mirrors it.
 */
export default defineEventHandler(async (event) => {
  const key = sanitizeGrillKey(getRouterParam(event, 'key'))
  if (!(await readGrill(key))) throw createError({ statusCode: 404, message: `No such session: ${key}` })

  const stream = createEventStream(event)
  let closed = false
  const push = async () => {
    if (closed) return
    const session = await readGrill(key)
    // A mid-write read can parse as null; the debounced next event re-reads.
    if (!session || closed) return
    try {
      await stream.push(JSON.stringify(session))
    } catch {
      // The client went away mid-push; onClosed tears the watcher down.
    }
  }

  // Watch the directory, not the file — the file may be replaced on write.
  let timer: ReturnType<typeof setTimeout> | null = null
  const watcher = watch(appDataDir('jgrilling'), (_evt, filename) => {
    if (filename !== `${key}.json`) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(push, 100)
  })
  stream.onClosed(() => {
    closed = true
    watcher.close()
    if (timer) clearTimeout(timer)
  })

  // Initial push must land after send() has flushed the response headers —
  // pushing synchronously here would be dropped.
  setImmediate(push)
  return stream.send()
})
