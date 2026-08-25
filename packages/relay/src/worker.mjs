// Signaling relay for jTicket sync. Ferries opaque WebRTC handshake blobs
// between the (at most two) members of a room. Data-blind: it never parses a
// blob, and durable storage holds room metadata only — never blob contents.

import { CLOSE_REASONS } from './closeCodes.mjs'

const ROOM_TTL_MS = 2 * 60 * 60 * 1000

const intEnv = (value, fallback) => {
  const n = Number.parseInt(value ?? '', 10)
  return Number.isInteger(n) && n > 0 ? n : fallback
}

// Hardening knobs for the public deployment (TICK-309). Env-overridable so
// the local tests can pin tiny limits; unset in production = the defaults.
// The rate defaults leave room for jTicket's degraded-mode presence loop —
// one create + one join per share every 2s tick when dials keep failing,
// ≈30 of each per minute per share — so 120/min absorbs a few shares behind
// one NAT while still blunting an anonymous flood.
function config(env) {
  return {
    maxMessageBytes: intEnv(env.RELAY_MAX_MESSAGE_BYTES, 64 * 1024),
    createsPerMinute: intEnv(env.RELAY_CREATES_PER_MINUTE, 120),
    joinsPerMinute: intEnv(env.RELAY_JOINS_PER_MINUTE, 120),
    gcGraceMs: intEnv(env.RELAY_GC_GRACE_MS, 30 * 60_000),
    // A GC alarm that finds members still connected (an in-flight pull
    // riding out expiry) checks back this much later, not deleting under
    // them.
    gcRecheckMs: intEnv(env.RELAY_GC_RECHECK_MS, 10 * 60_000),
  }
}

async function sha256hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function randomSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// Refusals accept the socket, then close with an application code the client
// can observe (an HTTP error on upgrade surfaces codeless).
function refuseSocket(code) {
  const pair = new WebSocketPair()
  const [client, server] = Object.values(pair)
  server.accept()
  server.close(code, CLOSE_REASONS[code])
  return new Response(null, { status: 101, webSocket: client })
}

/** True when this request pushes its caller past the per-IP per-minute limit. */
async function overLimit(env, request, action, limit) {
  // Cloudflare stamps CF-Connecting-IP on every production request; locally
  // (Miniflare) it is absent unless a test spoofs it, so local traffic
  // shares one bucket.
  const ip = request.headers.get('CF-Connecting-IP') ?? 'local'
  const stub = env.LIMITS.get(env.LIMITS.idFromName(ip))
  const res = await stub.fetch('https://limits/check', {
    method: 'POST',
    body: JSON.stringify({ action, limit }),
  })
  return !(await res.json()).allowed
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const cfg = config(env)

    if (request.method === 'POST' && url.pathname === '/rooms') {
      if (await overLimit(env, request, 'create', cfg.createsPerMinute)) {
        return new Response('rate limited', { status: 429 })
      }
      // ttlMs can only shorten a room's life (tests use tiny rooms); the 2h
      // ceiling is the product rule and cannot be raised from outside.
      let ttlMs = ROOM_TTL_MS
      const body = await request.json().catch(() => null)
      if (Number.isFinite(body?.ttlMs) && body.ttlMs > 0) {
        ttlMs = Math.min(body.ttlMs, ROOM_TTL_MS)
      }
      // A client may supply its own room id + secret (jTicket shares mint the
      // pair locally at share time, and both peers "ensure" the room before
      // dialing). Re-registering with the matching secret only refreshes the
      // expiry; a killed room stays dead — a re-armed share is a new room.
      const supplied =
        typeof body?.roomId === 'string' && body.roomId && typeof body?.secret === 'string' && body.secret
      const roomId = supplied ? body.roomId : crypto.randomUUID()
      const secret = supplied ? body.secret : randomSecret()
      const stub = env.ROOMS.get(env.ROOMS.idFromName(roomId))
      const initRes = await stub.fetch('https://room/init', {
        method: 'POST',
        body: JSON.stringify({ secretHash: await sha256hex(secret), ttlMs }),
      })
      if (!initRes.ok) return new Response(await initRes.text(), { status: initRes.status })
      const { expiresAt } = await initRes.json()
      return Response.json({ roomId, secret, expiresAt }, { status: 201 })
    }

    const roomMatch = url.pathname.match(/^\/rooms\/([^/]+)(\/ws)?$/)
    if (roomMatch) {
      // Limited out here so a flood never reaches (or creates) the room DO.
      // Joins refuse with a close code like the room's own; everything else
      // that would touch a room (kills, probes) shares the join budget and
      // refuses with 429.
      const isJoin = roomMatch[2] && request.headers.get('Upgrade') === 'websocket'
      if (await overLimit(env, request, 'join', cfg.joinsPerMinute)) {
        return isJoin ? refuseSocket(4007) : new Response('rate limited', { status: 429 })
      }
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
  constructor(state, env) {
    this.state = state
    this.config = config(env)
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
      const existing = await this.state.storage.get('meta')
      if (existing?.killed) return new Response('room killed', { status: 409 })
      if (existing && existing.secretHash !== secretHash) return new Response('wrong secret', { status: 403 })
      const expiresAt = Date.now() + ttlMs
      const meta = { secretHash, expiresAt }
      await this.state.storage.put('meta', meta)
      // GC (TICK-288 deferred this): forget the room once it has expired and
      // emptied, instead of the metadata row lingering until Cloudflare
      // evicts the DO. A refresh overwrites the alarm along with the expiry.
      await this.state.storage.setAlarm(this.gcDeadline(meta))
      return Response.json({ expiresAt })
    }

    if (url.pathname.endsWith('/ws')) return this.join(request)

    if (request.method === 'DELETE') return this.kill(url)

    return new Response('not found', { status: 404 })
  }

  gcDeadline(meta) {
    return meta.expiresAt + this.config.gcGraceMs
  }

  // After expiry + grace the room is forgotten wholesale — killed rooms
  // included, so their ids become registrable again. That is fine: the
  // killed-stays-dead rule protects a live share's lifetime, and by now the
  // share link itself has long expired (a re-armed share is a new room).
  async alarm() {
    const meta = await this.state.storage.get('meta')
    if (!meta) return
    if (Date.now() < this.gcDeadline(meta)) {
      // A refresh moved the expiry past this alarm; wait for the new one.
      await this.state.storage.setAlarm(this.gcDeadline(meta))
      return
    }
    if (this.members.length > 0) {
      // In-flight pulls complete past expiry — check back once they're gone.
      await this.state.storage.setAlarm(Date.now() + this.config.gcRecheckMs)
      return
    }
    await this.state.storage.deleteAll()
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
        member.close(4005, CLOSE_REASONS[4005])
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

    const meta = await this.state.storage.get('meta')
    if (!meta) return refuseSocket(4001)

    if (meta.killed) return refuseSocket(4005)

    if (!(await secretMatches(new URL(request.url), meta))) return refuseSocket(4002)

    // Expiry gates new joins only — members already connected keep ferrying,
    // so an in-flight pull completes.
    if (Date.now() > meta.expiresAt) return refuseSocket(4004)

    if (this.members.length >= 2) return refuseSocket(4003)

    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)
    server.accept()

    this.members.push(server)

    const peerOf = (member) => this.members.find((other) => other !== member)

    const earlier = peerOf(server)
    if (earlier) {
      for (const blob of this.pending.get(earlier) ?? []) server.send(blob)
      this.pending.delete(earlier)
    }

    const drop = () => {
      this.members = this.members.filter((member) => member !== server)
      this.pending.delete(server)
    }

    server.addEventListener('message', (event) => {
      // Cap what one frame may carry. Handshake blobs are a few KB; anything
      // bigger is not our traffic, and the sender (not its peer) is ejected.
      const size =
        typeof event.data === 'string'
          ? new TextEncoder().encode(event.data).byteLength
          : event.data.byteLength
      if (size > this.config.maxMessageBytes) {
        drop()
        server.close(4006, CLOSE_REASONS[4006])
        return
      }
      const peer = peerOf(server)
      if (peer) {
        peer.send(event.data)
      } else {
        const queue = this.pending.get(server) ?? []
        queue.push(event.data)
        this.pending.set(server, queue)
      }
    })

    server.addEventListener('close', drop)
    server.addEventListener('error', drop)

    return new Response(null, { status: 101, webSocket: client })
  }
}

// Fixed-window rate limiter (one-minute windows), one DO instance per client
// IP. Counts live in memory only: an eviction hands a flooder the occasional
// fresh window in exchange for zero storage — this blunts abuse, it doesn't
// meter billing.
const RATE_WINDOW_MS = 60_000

export class RateLimiter {
  constructor() {
    this.buckets = new Map() // action → { start, count }
  }

  async fetch(request) {
    const { action, limit } = await request.json()
    const now = Date.now()
    let bucket = this.buckets.get(action)
    if (!bucket || now - bucket.start >= RATE_WINDOW_MS) {
      bucket = { start: now, count: 0 }
      this.buckets.set(action, bucket)
    }
    bucket.count += 1
    return Response.json({ allowed: bucket.count <= limit })
  }
}
