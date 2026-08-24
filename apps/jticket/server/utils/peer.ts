// Server-side WebRTC peer manager — jTicket's end of a sync connection.
//
// Lives in the Nuxt server process (no browser tab involved): dials a relay
// room over WebSocket, ferries the SDP/ICE handshake through it, and opens an
// encrypted node-datachannel data channel to the other jTicket instance. The
// /api/sync/peer routes are thin wrappers over this module; it is
// framework-free so tests can drive two managers in one process against a
// local relay.

import { PeerConnection, type DataChannel } from 'node-datachannel'
import { CLOSE_REASONS as RELAY_CLOSE_REASONS } from '@jsuite/relay/codes'

export type PeerState = 'connecting' | 'connected' | 'closed' | 'failed'

export interface DialOptions {
  /** http(s) base URL of the signaling relay. */
  relayUrl: string
  roomId: string
  secret: string
  /** The initiating side creates the data channel and sends the offer. */
  initiator: boolean
  /** Send every received message straight back — the harness's echo side. */
  echo?: boolean
  /** STUN/TURN servers; defaults to none (host candidates — fine locally). */
  iceServers?: string[]
  /**
   * Local address to bind ICE to. Unset, libjuice gathers the machine's real
   * interfaces (VPN subnets, rotating IPv6 privacy addresses) and skips
   * loopback — self-connections over those can intermittently die with
   * EADDRNOTAVAIL mid-DTLS. Tests bind 127.0.0.1 to stay off real interfaces.
   */
  bindAddress?: string
}

export interface PeerStatus {
  id: string
  state: PeerState
  /** Why the peer failed ('' unless state is 'failed'). */
  reason: string
  /** Messages received over the data channel so far, in order. */
  received: string[]
  /**
   * True once the signaling socket's close handshake has completed. The relay
   * frees the room's member slot when it processes that close, and the close
   * ack reaches us after that in every observed ordering (though no spec
   * guarantees it) — so gate a re-dial of the same room on this, paired with a
   * retry for the rare miss.
   */
  signalingClosed: boolean
}

export interface PeerManager {
  /** Start connecting; returns immediately. Progress is polled via get(). */
  dial(options: DialOptions): { id: string }
  get(id: string): PeerStatus | undefined
  /** Send over the open data channel. Throws if the peer isn't connected. */
  send(id: string, data: string): void
  /** Tear the connection down: data channel, peer connection, socket. */
  close(id: string): void
  /** Tear down every connection this manager owns. */
  closeAll(): void
}

// The handshake blobs both sides ferry through the relay. The relay treats
// them as opaque; this protocol is between the two peers only.
type Signal =
  | { kind: 'description'; type: string; sdp: string }
  | { kind: 'candidate'; candidate: string; mid: string }

interface Peer {
  id: string
  state: PeerState
  reason: string
  received: string[]
  pc: PeerConnection
  dc: DataChannel | null
  ws: WebSocket
  signalingClosed: boolean
  /** Candidates that arrived before the remote description — applied after. */
  pendingCandidates: Array<{ candidate: string; mid: string }>
  haveRemoteDescription: boolean
}

let nextId = 1

export function createPeerManager(): PeerManager {
  const peers = new Map<string, Peer>()

  function dial(options: DialOptions): { id: string } {
    const id = `peer_${nextId++}`
    const { relayUrl, roomId, secret, initiator, echo = false, iceServers = [], bindAddress } = options

    const wsUrl = new URL(`/rooms/${roomId}/ws`, relayUrl)
    wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:'
    wsUrl.searchParams.set('secret', secret)

    const pc = new PeerConnection(id, { iceServers, ...(bindAddress ? { bindAddress } : {}) })
    const ws = new WebSocket(wsUrl)
    const peer: Peer = {
      id,
      state: 'connecting',
      reason: '',
      received: [],
      pc,
      dc: null,
      ws,
      signalingClosed: false,
      pendingCandidates: [],
      haveRemoteDescription: false,
    }
    peers.set(id, peer)

    const fail = (reason: string) => {
      if (peer.state === 'connecting' || peer.state === 'connected') {
        peer.state = 'failed'
        peer.reason = reason
        teardown(peer)
      }
    }

    const sendSignal = (signal: Signal) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(signal))
      else if (ws.readyState === WebSocket.CONNECTING) {
        ws.addEventListener('open', () => ws.send(JSON.stringify(signal)), { once: true })
      }
    }

    const adoptChannel = (dc: DataChannel) => {
      peer.dc = dc
      dc.onOpen(() => {
        peer.state = 'connected'
        // The handshake is done — the signaling socket has served its purpose,
        // and leaving frees the room's member slot for a later re-dial.
        ws.close()
      })
      dc.onMessage((msg) => {
        const text = typeof msg === 'string' ? msg : Buffer.from(msg as ArrayBuffer).toString()
        peer.received.push(text)
        if (echo) dc.sendMessage(text)
      })
      dc.onClosed(() => {
        if (peer.state === 'connected' || peer.state === 'connecting') {
          peer.state = 'closed'
        }
      })
    }

    pc.onLocalDescription((sdp, type) => sendSignal({ kind: 'description', type, sdp }))
    pc.onLocalCandidate((candidate, mid) => sendSignal({ kind: 'candidate', candidate, mid }))
    pc.onStateChange((state) => {
      if (state === 'failed') fail('peer connection failed')
      else if ((state === 'closed' || state === 'disconnected') && peer.state === 'connected') {
        peer.state = 'closed'
      }
    })

    if (initiator) {
      // Creating the channel kicks off offer generation.
      adoptChannel(pc.createDataChannel('sync'))
    } else {
      pc.onDataChannel((dc) => {
        adoptChannel(dc)
        // The channel arrives already open on the receiving side.
        if (dc.isOpen()) {
          peer.state = 'connected'
          ws.close()
        }
      })
    }

    ws.addEventListener('message', (event) => {
      let signal: Signal
      try {
        signal = JSON.parse(String(event.data))
      } catch {
        return
      }
      if (signal.kind === 'description') {
        pc.setRemoteDescription(signal.sdp, signal.type as never)
        peer.haveRemoteDescription = true
        for (const c of peer.pendingCandidates.splice(0)) pc.addRemoteCandidate(c.candidate, c.mid)
      } else if (signal.kind === 'candidate') {
        if (peer.haveRemoteDescription) pc.addRemoteCandidate(signal.candidate, signal.mid)
        else peer.pendingCandidates.push({ candidate: signal.candidate, mid: signal.mid })
      }
    })
    ws.addEventListener('close', (event) => {
      peer.signalingClosed = true
      const refusal = RELAY_CLOSE_REASONS[event.code]
      if (refusal) fail(`relay refused: ${refusal}`)
      else if (peer.state === 'connecting') fail('signaling socket closed before the channel opened')
    })
    ws.addEventListener('error', () => {
      if (peer.state === 'connecting') fail('could not reach the relay')
    })

    return { id }
  }

  function teardown(peer: Peer) {
    try {
      peer.dc?.close()
    } catch {}
    try {
      peer.pc.close()
    } catch {}
    try {
      peer.ws.close()
    } catch {}
  }

  function mustGet(id: string): Peer {
    const peer = peers.get(id)
    if (!peer) throw new Error(`unknown peer: ${id}`)
    return peer
  }

  return {
    dial,
    get(id) {
      const peer = peers.get(id)
      if (!peer) return undefined
      const { state, reason, received, signalingClosed } = peer
      return { id, state, reason, received: [...received], signalingClosed }
    },
    send(id, data) {
      const peer = mustGet(id)
      if (peer.state !== 'connected' || !peer.dc?.isOpen()) {
        throw new Error(`peer ${id} is not connected (state: ${peer.state})`)
      }
      peer.dc.sendMessage(data)
    },
    close(id) {
      const peer = mustGet(id)
      if (peer.state !== 'failed') peer.state = 'closed'
      teardown(peer)
    },
    closeAll() {
      for (const peer of peers.values()) {
        if (peer.state !== 'failed') peer.state = 'closed'
        teardown(peer)
      }
    },
  }
}

/** The server process's one manager, shared by the /api/sync/peer routes. */
let managerSingleton: PeerManager | undefined
export function usePeerManager(): PeerManager {
  managerSingleton ??= createPeerManager()
  return managerSingleton
}
