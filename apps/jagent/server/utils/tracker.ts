// HTTP client for jTicket (:43000) plus its SSE stream. jAgent stores no
// tickets — the board stays the source of truth; jAgent only claims, comments,
// observes resolutions, and flips status to done at accept.

const JTICKET = () => process.env.JTICKET_URL || 'http://localhost:43000'

export interface TrackerTicket {
  id: string
  key: string
  title: string
  description: string
  acceptanceCriteria: string[]
  status: 'todo' | 'in_progress' | 'done'
  epicId: string | null
  assignee: string
  labels: string[]
  resolution: string
  blockedBy: string[]
  blocked?: boolean
  claimed?: boolean
  frontier?: boolean
  updatedAt: string
}

async function trackerFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${JTICKET()}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
      signal: AbortSignal.timeout(8000),
    })
  } catch {
    throw createError({ statusCode: 502, message: `jTicket unreachable at ${JTICKET()} — is the suite running?` })
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw createError({ statusCode: res.status, message: `jTicket ${res.status} on ${path}: ${body.slice(0, 200)}` })
  }
  return res.json() as Promise<T>
}

export function trackerTicket(key: string): Promise<TrackerTicket> {
  return trackerFetch(`/api/tickets/${encodeURIComponent(key)}`)
}

export function trackerTickets(query: string): Promise<TrackerTicket[]> {
  return trackerFetch(`/api/tickets${query}`)
}

export function trackerEpics(): Promise<{ id: string; key: string; title: string }[]> {
  return trackerFetch('/api/epics')
}

export function trackerPatchTicket(key: string, body: Record<string, unknown>): Promise<TrackerTicket> {
  return trackerFetch(`/api/tickets/${encodeURIComponent(key)}`, { method: 'PATCH', body: JSON.stringify(body) })
}

export function trackerComment(key: string, author: string, body: string): Promise<unknown> {
  return trackerFetch(`/api/tickets/${encodeURIComponent(key)}/comments`, {
    method: 'POST',
    body: JSON.stringify({ author, body }),
  })
}

export async function trackerUp(): Promise<boolean> {
  try {
    await trackerFetch('/api/projects')
    return true
  } catch {
    return false
  }
}

// Minimal SSE reader over fetch — jTicket's stream carries only revision
// numbers ({"kind":"change","revision":N}), so the callback takes no payload:
// the subscriber refetches what it cares about. Reconnects forever; a fresh
// `hello` after reconnect also fires the callback (revisions reset on restart).
export function trackerSubscribe(onChange: () => void): () => void {
  let stopped = false
  let controller: AbortController | null = null

  const connect = async () => {
    while (!stopped) {
      controller = new AbortController()
      try {
        const res = await fetch(`${JTICKET()}/api/stream`, { signal: controller.signal })
        if (!res.ok || !res.body) throw new Error(`stream ${res.status}`)
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buf = ''
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          let idx
          while ((idx = buf.indexOf('\n\n')) !== -1) {
            const chunk = buf.slice(0, idx)
            buf = buf.slice(idx + 2)
            for (const line of chunk.split('\n')) {
              if (!line.startsWith('data:')) continue
              try {
                const msg = JSON.parse(line.slice(5))
                if (msg.kind === 'change' || msg.kind === 'hello') onChange()
              } catch { /* not JSON — ignore */ }
            }
          }
        }
      } catch { /* server down or connection dropped — retry below */ }
      if (!stopped) await new Promise((r) => setTimeout(r, 3000))
    }
  }
  void connect()

  return () => {
    stopped = true
    controller?.abort()
  }
}
