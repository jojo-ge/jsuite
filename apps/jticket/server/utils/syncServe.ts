import type { PeerManager } from './peer'
import { usePeerManager } from './peer'
import type { Store } from './store'
import { loadStore } from './store'
import { shareStatus } from './shares'
import { ensureRelayRoom } from './relayRooms'
import { assembleSyncSnapshot } from './syncIo'
import type { PullWireMessage } from './syncWire'
import { encodeWireMessage, parseWireMessage, snapshotFrames } from './syncWire'
import { handshakeTimeoutMs as configHandshakeTimeoutMs, pullRequestTtlMs, syncRelayUrl } from './syncConfig'

// The serving side of the pull flow (TICK-294, spec DOC-30). While a share
// this machine created is active, a presence dial waits in its relay room; an
// importer's pull-request becomes a pending approval the human answers in the
// UI. Approve builds the snapshot and streams it over the channel; deny and
// expiry send a refusal and transfer nothing. Framework-free — the Nitro
// plugin drives tick() on an interval, tests drive it directly.

export interface PendingPullView {
  id: string
  projectId: string
  projectKey: string
  projectTitle: string
  /** Who is asking — the peer's name from project.share, never wire text. */
  requester: string
  requestedAt: string
  expiresAt: string
}

interface PendingPull {
  id: string
  shareId: string
  peerId: string
  requestedAt: number
  expiresAt: number
}

/** A refused approve/deny, with the HTTP status it maps to. */
export class PullAnswerError extends Error {
  constructor(message: string, public readonly statusCode: number) {
    super(message)
  }
}

export interface SyncServerOptions {
  peers: PeerManager
  relayUrl: () => string
  loadState: () => Store
  requestTtlMs?: number
  handshakeTimeoutMs?: number
  nowMs?: () => number
}

export interface SyncServer {
  /** Presence + expiry maintenance — idempotent, cheap, run on an interval. */
  tick(): Promise<void>
  pending(): PendingPullView[]
  approve(requestId: string): Promise<void>
  deny(requestId: string): void
  stop(): void
}

export function createSyncServer(options: SyncServerOptions): SyncServer {
  const { peers, relayUrl, loadState, requestTtlMs = 120_000, handshakeTimeoutMs, nowMs = Date.now } = options
  const conns = new Map<string, string>() // share id → waiting/serving peer id
  const pendings = new Map<string, PendingPull>()
  let stopped = false

  const nowIso = () => new Date(nowMs()).toISOString()

  const sendSafe = (peerId: string, message: PullWireMessage) => {
    try {
      peers.send(peerId, encodeWireMessage(message))
    } catch {}
  }
  const refuse = (peerId: string, requestId: string, reason: string) =>
    sendSafe(peerId, { v: 1, kind: 'pull-refused', requestId, reason })

  function handleMessage(shareId: string, peerId: () => string, raw: string) {
    const msg = parseWireMessage(raw)
    if (!msg || msg.kind !== 'pull-request') return // the importer speaks first and only asks
    const store = loadState()
    const share = store.shares.find((s) => s.id === shareId)
    if (!share || share.projectUuid !== msg.projectUuid) {
      refuse(peerId(), msg.requestId, 'this room does not serve that project')
      return
    }
    // The start-of-serving gate (DOC-30): expiry and revocation refuse new
    // requests; requests already pending ride out expiry (not revocation).
    const status = shareStatus(share, nowIso())
    if (status !== 'active') {
      refuse(peerId(), msg.requestId, `share ${status}`)
      return
    }
    if (!store.projects.some((p) => p.id === share.projectId)) {
      refuse(peerId(), msg.requestId, 'the shared project no longer exists')
      return
    }
    if (pendings.has(msg.requestId)) return
    pendings.set(msg.requestId, {
      id: msg.requestId,
      shareId,
      peerId: peerId(),
      requestedAt: nowMs(),
      expiresAt: nowMs() + requestTtlMs,
    })
  }

  async function tick(): Promise<void> {
    if (stopped) return

    // Sweep pending requests: gone when their channel died, expired when the
    // human never answered — either way nothing transfers.
    for (const [id, p] of [...pendings]) {
      if (peers.get(p.peerId)?.state !== 'connected') {
        pendings.delete(id)
        continue
      }
      if (nowMs() >= p.expiresAt) {
        sendSafe(p.peerId, { v: 1, kind: 'pull-expired', requestId: id })
        pendings.delete(id)
      }
    }

    // Presence: one waiting dial per active share this machine created.
    const store = loadState()
    const url = relayUrl()
    for (const share of store.shares) {
      if (share.side !== 'creator') continue
      const active = shareStatus(share, nowIso()) === 'active' && store.projects.some((p) => p.id === share.projectId)
      const peerId = conns.get(share.id)
      const state = peerId ? peers.get(peerId)?.state : undefined
      if (!active) {
        // Close only a *waiting* dial — a connected one may be mid-pull, and
        // in-flight pulls complete across expiry.
        if (peerId && state === 'connecting') {
          peers.close(peerId)
          conns.delete(share.id)
        }
        continue
      }
      if (!url || state === 'connecting' || state === 'connected') continue
      try {
        await ensureRelayRoom(url, share, nowMs)
      } catch {
        continue // relay down or refusing — retry next tick
      }
      const holder = { id: '' }
      holder.id = peers.dial({
        relayUrl: url,
        roomId: share.roomId,
        secret: share.roomSecret,
        initiator: false,
        ...(handshakeTimeoutMs ? { handshakeTimeoutMs } : {}),
        // The hello tells the importer this side is listening — its request
        // would race the fresh channel's handler attachment otherwise.
        onOpen: () => sendSafe(holder.id, { v: 1, kind: 'serve-ready' }),
        onMessage: (raw) => handleMessage(share.id, () => holder.id, raw),
      }).id
      conns.set(share.id, holder.id)
    }
  }

  return {
    tick,
    pending() {
      const store = loadState()
      const out: PendingPullView[] = []
      for (const p of pendings.values()) {
        const share = store.shares.find((s) => s.id === p.shareId)
        const project = share && store.projects.find((pr) => pr.id === share.projectId)
        if (!project) continue
        out.push({
          id: p.id,
          projectId: project.id,
          projectKey: project.key,
          projectTitle: project.title,
          requester: project.share?.peerName || 'your peer',
          requestedAt: new Date(p.requestedAt).toISOString(),
          expiresAt: new Date(p.expiresAt).toISOString(),
        })
      }
      return out
    },
    async approve(requestId) {
      const p = pendings.get(requestId)
      if (!p) throw new PullAnswerError(`unknown pull request: ${requestId}`, 404)
      const store = loadState()
      const share = store.shares.find((s) => s.id === p.shareId)
      if (!share) {
        pendings.delete(requestId)
        throw new PullAnswerError('the share no longer exists', 409)
      }
      // Revocation is a hard stop; expiry is not — this request arrived while
      // the link was alive, and in-flight pulls complete (DOC-30).
      if (shareStatus(share, nowIso()) === 'revoked') {
        refuse(p.peerId, requestId, 'share revoked')
        pendings.delete(requestId)
        throw new PullAnswerError('share revoked — stop-sharing halts serving immediately', 409)
      }
      if (peers.get(p.peerId)?.state !== 'connected') {
        pendings.delete(requestId)
        throw new PullAnswerError('the requester is no longer connected', 409)
      }
      const snapshot = await assembleSyncSnapshot(store, share, nowIso())
      for (const frame of snapshotFrames(requestId, JSON.stringify(snapshot))) {
        peers.send(p.peerId, frame)
      }
      pendings.delete(requestId)
    },
    deny(requestId) {
      const p = pendings.get(requestId)
      if (!p) throw new PullAnswerError(`unknown pull request: ${requestId}`, 404)
      sendSafe(p.peerId, { v: 1, kind: 'pull-denied', requestId })
      pendings.delete(requestId)
    },
    stop() {
      stopped = true
      for (const peerId of conns.values()) {
        try {
          peers.close(peerId)
        } catch {}
      }
      conns.clear()
      pendings.clear()
    },
  }
}

/** The server process's one sync server, driven by the sync-serve plugin. */
let singleton: SyncServer | undefined
export function useSyncServer(): SyncServer {
  singleton ??= createSyncServer({
    peers: usePeerManager(),
    relayUrl: syncRelayUrl,
    loadState: loadStore,
    requestTtlMs: pullRequestTtlMs(),
    handshakeTimeoutMs: configHandshakeTimeoutMs(),
  })
  return singleton
}
