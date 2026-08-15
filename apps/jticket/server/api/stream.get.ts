/**
 * SSE: the board's live wire.
 *
 * One `change` message per store revision — no payload beyond the revision
 * number, because the client refetches the four collections it already knows
 * how to fetch. That keeps this endpoint independent of the data model: adding
 * a field never means teaching the stream about it.
 *
 *   curl -N http://localhost:43000/api/stream
 *   {"kind":"hello","revision":0}
 *   {"kind":"change","revision":1}
 *
 * `hello` doubles as the reconnect signal: a client that already saw a
 * revision, or that reconnects to a restarted server, refetches on it rather
 * than trusting the number to be comparable across connections.
 */
const HEARTBEAT_MS = 25_000

export default defineEventHandler((event) => {
  const stream = createEventStream(event)
  const push = (kind: string, data: Record<string, unknown> = {}) =>
    stream.push(JSON.stringify({ kind, ...data }))

  push('hello', { revision: currentRevision() })

  const off = onStoreChange((revision) => {
    push('change', { revision })
  })
  // Nothing between here and the browser buffers SSE, but an idle connection
  // through Caddy still wants traffic — and the ping is what a paused laptop's
  // EventSource trips over on wake, which is how the client notices it is stale.
  const beat = setInterval(() => push('ping'), HEARTBEAT_MS)

  stream.onClosed(() => {
    off()
    clearInterval(beat)
  })

  return stream.send()
})
