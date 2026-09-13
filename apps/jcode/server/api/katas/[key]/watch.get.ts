import { watch } from 'node:fs'
import { mkdirSync } from 'node:fs'
import { appDataDir } from '@jsuite/data'

/**
 * SSE: the live kata (redacted view). Pushes immediately and again whenever
 * its file in .data/jcode changes — how the page sees the marker's verdict
 * land, with no polling. The file is the single source of truth; this
 * endpoint mirrors it through kataView so a push can't leak a locked rung.
 */
export default defineEventHandler(async (event) => {
  const key = sanitizeKataKey(getRouterParam(event, 'key'))
  if (!(await readKata(key))) throw createError({ statusCode: 404, message: `No such kata: ${key}` })

  const stream = createEventStream(event)
  let closed = false
  const push = async () => {
    if (closed) return
    const kata = await readKata(key)
    // A mid-write read can parse as null; the debounced next event re-reads.
    if (!kata || closed) return
    try {
      await stream.push(JSON.stringify(kataView(kata)))
    } catch {
      // The client went away mid-push; onClosed tears the watcher down.
    }
  }

  // Watch the directory, not the file — the file may be replaced on write.
  const dir = appDataDir('jcode')
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
