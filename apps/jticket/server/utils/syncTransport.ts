import { RealtimeClient } from '@supabase/realtime-js'

// The transport port: a named topic that fans opaque strings out to whoever
// else has joined it. That is the whole contract sync needs from the outside
// world, and it is deliberately narrow — everything that makes sync *sync*
// (framing, encryption, the approval protocol, share gating) sits above this
// line and is transport-independent.
//
// Two adapters implement it:
//   • supabase — Realtime Broadcast, the production transport. One outbound
//     WSS connection to <project>.supabase.co:443, which is the whole point:
//     no UDP, no ICE, no NAT traversal, so it works on networks where the
//     WebRTC data channel could never form.
//   • local — a tiny WebSocket broadcast server (@jsuite/relay's
//     startLocalRelay) that the two-instance test harness runs in-process, so
//     e2e sync stays offline and free.
//
// Frames are already sealed when they reach a transport (syncCrypto), so
// neither adapter can read them and no adapter is trusted to keep a secret.

export interface TopicHandlers {
  /** One sealed frame from another member of the topic. */
  onFrame: (sealed: string) => void
  /** The topic is live — sends from here on will reach joined members. */
  onJoined: () => void
  /** The topic failed or dropped; reason is for the UI, never for control flow. */
  onError: (reason: string) => void
}

export interface TransportTopic {
  send(sealed: string): Promise<void>
  leave(): void
}

export interface SyncTransport {
  join(topic: string, handlers: TopicHandlers): TransportTopic
  /** Tear down the underlying connection and every topic on it. */
  dispose(): void
}

/** Broadcast event name. One event carries every frame; the seal is the payload. */
const EVENT = 'frame'

// ── Supabase Realtime ───────────────────────────────────────────────────────

export function createSupabaseTransport(supabaseUrl: string, apiKey: string): SyncTransport {
  // https://<ref>.supabase.co → wss://<ref>.supabase.co/realtime/v1; the
  // phoenix socket appends /websocket itself.
  const endpoint = `${supabaseUrl.replace(/\/+$/, '').replace(/^http/, 'ws')}/realtime/v1`
  const client = new RealtimeClient(endpoint, { params: { apikey: apiKey } })

  return {
    join(topic, handlers) {
      // Public channel (no `private: true`): authorizing it would need a JWT
      // both machines accept, i.e. a shared signing secret — a worse key to
      // distribute than the room secret the link already carries. The topic
      // name is a 96-bit random room id and the payloads are sealed, so an
      // unauthenticated subscriber learns nothing and can forge nothing.
      // ack makes send() await the server, which is also our flow control:
      // snapshot chunks go out one confirmed frame at a time rather than
      // blasting past the project's messages-per-second quota.
      const channel = client.channel(topic, { config: { broadcast: { self: false, ack: true } } })
      channel.on('broadcast', { event: EVENT }, (message: { payload?: unknown }) => {
        const sealed = (message.payload as { sealed?: unknown } | undefined)?.sealed
        if (typeof sealed === 'string') handlers.onFrame(sealed)
      })
      // realtime-js reconnects on its own, re-running this callback — so both
      // signals can repeat, and the layer above decides what a repeat means.
      channel.subscribe((status: string, error?: Error) => {
        if (status === 'SUBSCRIBED') {
          handlers.onJoined()
        } else if (status === 'CHANNEL_ERROR') {
          handlers.onError(error?.message || 'the realtime channel errored')
        } else if (status === 'TIMED_OUT') {
          handlers.onError('the realtime channel timed out')
        }
      })
      return {
        async send(sealed) {
          const result = await channel.send({ type: 'broadcast', event: EVENT, payload: { sealed } })
          // With ack on, anything but 'ok' means the server never took it —
          // surfacing that lets a snapshot fail loudly instead of half-arriving.
          if (result !== 'ok') throw new Error(`realtime rejected the frame: ${result}`)
        },
        leave() {
          try {
            channel.unsubscribe()
          } catch {}
        },
      }
    },
    dispose() {
      try {
        client.disconnect()
      } catch {}
    },
  }
}

// ── Local WebSocket broadcast (tests) ───────────────────────────────────────
// Speaks @jsuite/relay's local protocol: one socket per topic, a join frame,
// then sealed frames fanned out to the topic's other sockets. Semantically
// identical to a Supabase broadcast channel, which is what the tests above
// this line actually depend on.

interface LocalWire {
  t: 'join' | 'frame'
  topic: string
  sealed?: string
}

export function createLocalTransport(relayUrl: string): SyncTransport {
  const url = relayUrl.replace(/^http/, 'ws').replace(/\/+$/, '')
  const sockets = new Set<WebSocket>()

  return {
    join(topic, handlers) {
      const ws = new WebSocket(url)
      sockets.add(ws)
      // Frames sent before the socket opens would be dropped on the floor, so
      // queue them — the serving side answers the instant it is asked, and the
      // socket may still be connecting.
      const queued: string[] = []
      let open = false

      ws.addEventListener('open', () => {
        open = true
        ws.send(JSON.stringify({ t: 'join', topic } satisfies LocalWire))
        for (const sealed of queued.splice(0)) {
          ws.send(JSON.stringify({ t: 'frame', topic, sealed } satisfies LocalWire))
        }
        handlers.onJoined()
      })
      ws.addEventListener('message', (event: MessageEvent) => {
        let wire: LocalWire
        try {
          wire = JSON.parse(String(event.data))
        } catch {
          return
        }
        if (wire.t === 'frame' && typeof wire.sealed === 'string') handlers.onFrame(wire.sealed)
      })
      ws.addEventListener('error', () => handlers.onError('could not reach the local relay'))
      ws.addEventListener('close', () => {
        sockets.delete(ws)
        handlers.onError('the local relay closed the socket')
      })

      return {
        async send(sealed) {
          if (!open) {
            queued.push(sealed)
            return
          }
          ws.send(JSON.stringify({ t: 'frame', topic, sealed } satisfies LocalWire))
        },
        leave() {
          sockets.delete(ws)
          try {
            ws.close()
          } catch {}
        },
      }
    },
    dispose() {
      for (const ws of sockets) {
        try {
          ws.close()
        } catch {}
      }
      sockets.clear()
    },
  }
}
