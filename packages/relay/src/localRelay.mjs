import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'

// A local stand-in for Supabase Realtime Broadcast, for tests and offline
// development.
//
// jTicket's production sync rides Supabase Realtime: both machines join a
// broadcast topic named by the share's room id and fan sealed frames at each
// other. This server provides the same *semantics* over a trivial protocol —
// join a topic, and every frame you send reaches the topic's other members —
// so the two-instance harness can prove sync end to end without a network, an
// account, or a quota.
//
// It deliberately does NOT reimplement Supabase's phoenix wire format. The
// adapter that speaks that format (syncTransport's supabase branch) is thin
// and its own concern; what the layers above it depend on, and what this
// server stands in for, is topic fan-out.
//
// It is also not a security boundary: frames are already sealed with the room
// secret before they arrive, so this server — like the real one — carries
// bytes it cannot read.

/**
 * @typedef {{ url: string, port: number, dispose: () => Promise<void> }} LocalRelay
 */

/** @returns {Promise<LocalRelay>} */
export async function startLocalRelay({ port = 0, host = '127.0.0.1' } = {}) {
  const http = createServer((_req, res) => {
    res.writeHead(426, { 'content-type': 'text/plain' })
    res.end('expected a websocket upgrade')
  })
  const wss = new WebSocketServer({ server: http })

  /** @type {Map<string, Set<import('ws').WebSocket>>} topic → members */
  const topics = new Map()

  wss.on('connection', (socket) => {
    /** @type {Set<string>} the topics this socket has joined */
    const joined = new Set()

    socket.on('message', (raw) => {
      let wire
      try {
        wire = JSON.parse(String(raw))
      } catch {
        return // not our protocol; ignore rather than disconnect
      }
      if (typeof wire?.topic !== 'string' || !wire.topic) return

      if (wire.t === 'join') {
        joined.add(wire.topic)
        const members = topics.get(wire.topic) ?? new Set()
        members.add(socket)
        topics.set(wire.topic, members)
        return
      }

      if (wire.t === 'frame' && typeof wire.sealed === 'string') {
        // Fan out to everyone else on the topic. Like a Supabase broadcast
        // with `self: false`, the sender never hears its own frame — the pull
        // protocol relies on that (both sides sit on one topic).
        const payload = JSON.stringify({ t: 'frame', topic: wire.topic, sealed: wire.sealed })
        for (const member of topics.get(wire.topic) ?? []) {
          if (member !== socket && member.readyState === member.OPEN) member.send(payload)
        }
      }
    })

    socket.on('close', () => {
      for (const topic of joined) {
        const members = topics.get(topic)
        if (!members) continue
        members.delete(socket)
        if (members.size === 0) topics.delete(topic)
      }
    })
  })

  await new Promise((resolve) => http.listen(port, host, resolve))
  const { port: bound } = /** @type {{ port: number }} */ (http.address())

  return {
    url: `ws://${host}:${bound}`,
    port: bound,
    async dispose() {
      for (const client of wss.clients) client.terminate()
      await new Promise((resolve) => wss.close(resolve))
      await new Promise((resolve) => http.close(resolve))
    },
  }
}
