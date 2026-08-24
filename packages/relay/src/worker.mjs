// Signaling relay for jTicket sync. Ferries opaque WebRTC handshake blobs
// between the (at most two) members of a room. Data-blind: it never parses a
// blob, and durable storage holds room metadata only — never blob contents.

const ROOM_TTL_MS = 2 * 60 * 60 * 1000

async function sha256hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function randomSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    if (request.method === 'POST' && url.pathname === '/rooms') {
      const roomId = crypto.randomUUID()
      const secret = randomSecret()
      // ttlMs can only shorten a room's life (tests use tiny rooms); the 2h
      // ceiling is the product rule and cannot be raised from outside.
      let ttlMs = ROOM_TTL_MS
      const body = await request.json().catch(() => null)
      if (Number.isFinite(body?.ttlMs) && body.ttlMs > 0) {
        ttlMs = Math.min(body.ttlMs, ROOM_TTL_MS)
      }
      const stub = env.ROOMS.get(env.ROOMS.idFromName(roomId))
      const initRes = await stub.fetch('https://room/init', {
        method: 'POST',
        body: JSON.stringify({ secretHash: await sha256hex(secret), ttlMs }),
      })
      const { expiresAt } = await initRes.json()
      return Response.json({ roomId, secret, expiresAt }, { status: 201 })
    }

    const roomMatch = url.pathname.match(/^\/rooms\/([^/]+)(\/ws)?$/)
    if (roomMatch) {
      const stub = env.ROOMS.get(env.ROOMS.idFromName(roomMatch[1]))
      return stub.fetch(request)
    }

    return new Response('not found', { status: 404 })
  },
}

async function secretMatches(url, meta) {
  const secret = url.searchParams.get('secret') ?? ''
  return (await sha256hex(secret)) === meta.secretHash
}

export class RelayRoom {
  constructor(state) {
    this.state = state
    this.members = []
    // Blobs sent while the peer is absent, keyed by sender socket. Memory
    // only, flushed when the peer joins, discarded when the sender leaves —
    // never written to storage.
    this.pending = new Map()
  }

  async fetch(request) {
    const url = new URL(request.url)

    if (request.method === 'POST' && url.pathname === '/init') {
      const { secretHash, ttlMs } = await request.json()
      const expiresAt = Date.now() + ttlMs
      await this.state.storage.put('meta', { secretHash, expiresAt })
      return Response.json({ expiresAt })
    }

    if (url.pathname.endsWith('/ws')) return this.join(request)

    if (request.method === 'DELETE') return this.kill(url)

    return new Response('not found', { status: 404 })
  }

  async kill(url) {
    const meta = await this.state.storage.get('meta')
    if (!meta) return new Response('unknown room', { status: 404 })

    if (!(await secretMatches(url, meta))) {
      return new Response('wrong secret', { status: 403 })
    }

    meta.killed = true
    await this.state.storage.put('meta', meta)
    for (const member of this.members) {
      try {
        member.close(4005, 'room killed')
      } catch {}
    }
    this.members = []
    this.pending.clear()
    return new Response(null, { status: 204 })
  }

  async join(request) {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('expected a websocket upgrade', { status: 426 })
    }

    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)
    server.accept()

    // Refusals accept the socket, then close with an application code the
    // client can observe (an HTTP error on upgrade surfaces codeless).
    const refuse = (code, reason) => {
      server.close(code, reason)
      return new Response(null, { status: 101, webSocket: client })
    }

    const meta = await this.state.storage.get('meta')
    if (!meta) return refuse(4001, 'unknown room')

    if (meta.killed) return refuse(4005, 'room killed')

    if (!(await secretMatches(new URL(request.url), meta))) return refuse(4002, 'wrong secret')

    // Expiry gates new joins only — members already connected keep ferrying,
    // so an in-flight pull completes.
    if (Date.now() > meta.expiresAt) return refuse(4004, 'room expired')

    if (this.members.length >= 2) return refuse(4003, 'room full')

    this.members.push(server)

    const peerOf = (member) => this.members.find((other) => other !== member)

    const earlier = peerOf(server)
    if (earlier) {
      for (const blob of this.pending.get(earlier) ?? []) server.send(blob)
      this.pending.delete(earlier)
    }

    server.addEventListener('message', (event) => {
      const peer = peerOf(server)
      if (peer) {
        peer.send(event.data)
      } else {
        const queue = this.pending.get(server) ?? []
        queue.push(event.data)
        this.pending.set(server, queue)
      }
    })

    const drop = () => {
      this.members = this.members.filter((member) => member !== server)
      this.pending.delete(server)
    }
    server.addEventListener('close', drop)
    server.addEventListener('error', drop)

    return new Response(null, { status: 101, webSocket: client })
  }
}
