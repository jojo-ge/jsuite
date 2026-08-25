import type { ChannelManager } from './syncChannel'
import { useChannelManager } from './syncChannel'
import type { Store } from './store'
import { loadStore } from './store'
import type { Share } from './shares'
import { serveRoom, shareStatus } from './shares'
import { assembleSyncSnapshot } from './syncIo'
import type { PullWireMessage } from './syncWire'
import { snapshotFrames } from './syncWire'
import { pullRequestTtlMs, syncRelayConfig } from './syncConfig'

// The serving side of the pull flow (TICK-294, spec DOC-30). While a share is
// active, this side sits joined to the channel it serves (creator: the main
// room, importer: the reverse one — TICK-295 made pulls bidirectional); the
// peer's pull-request becomes a pending approval the human answers in the UI.
// Approve builds the snapshot and streams it over the channel; deny and expiry
// send a refusal and transfer nothing. Framework-free — the Nitro plugin
// drives tick() on an interval, tests drive it directly.
//
// Since sync moved off WebRTC (TICK-3xx) this loop is much duller: joining a
// broadcast topic has no handshake to fail, so there is no redial ladder, no
// reclaim grace, and no way for both of a room's slots to end up ours. A
// channel that is joined stays joined; one that fails is re-joined next tick.

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
  channelId: string
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
  /** Null when no relay is configured — the loop then does nothing at all. */
  channels: () => ChannelManager | null
  loadState: () => Store
  requestTtlMs?: number
  /**
   * How long a channel outlives its share going inactive, measured from the
   * last frame the peer sent. The share is already refused at the gate — this
   * only keeps us on the topic long enough to SAY so, so an importer who asked
   * as the clock ran out reads 'share expired' instead of waiting out their
   * ack timeout in silence. Revocation doesn't wait for it (announceRevoked
   * leaves immediately), and a channel nobody is talking on is dropped at once.
   */
  inactiveLingerMs?: number
  nowMs?: () => number
}

export interface SyncServer {
  /** Presence + expiry maintenance — idempotent, cheap, run on an interval. */
  tick(): Promise<void>
  pending(): PendingPullView[]
  approve(requestId: string): Promise<void>
  deny(requestId: string): void
  /** Tell a share's peers it is revoked, then drop its channel. */
  announceRevoked(share: Share, reason?: string): Promise<void>
  stop(): void
}

export function createSyncServer(options: SyncServerOptions): SyncServer {
  const { channels, loadState, requestTtlMs = 120_000, inactiveLingerMs = 60_000, nowMs = Date.now } = options
  // share id → the channel serving it, and the room it was joined for. The
  // room matters: re-sharing rotates a share's room ids in place, keeping the
  // record (and its id), so a channel still sitting on the old topic would
  // serve a room nobody dials any more. Under WebRTC this could not happen —
  // channels died after every pull and were re-dialed against fresh state.
  const conns = new Map<string, { channelId: string; roomId: string }>()
  const lastHeard = new Map<string, number>() // share id → when its peer last spoke
  const pendings = new Map<string, PendingPull>()
  let stopped = false
  let ticking = false

  const nowIso = () => new Date(nowMs()).toISOString()

  const sendSafe = (channelId: string, message: PullWireMessage) => {
    const manager = channels()
    if (!manager) return
    // Fire and forget: a refusal the peer never hears is exactly the silence
    // they would get from a crashed app, and every path here has a timeout.
    void manager.send(channelId, message).catch(() => {})
  }
  const refuse = (channelId: string, requestId: string, reason: string) =>
    sendSafe(channelId, { v: 1, kind: 'pull-refused', requestId, reason })

  function handleMessage(shareId: string, channelId: () => string, msg: PullWireMessage) {
    if (msg.kind !== 'pull-request') return // the importer speaks first and only asks
    // A repeat of a request we already hold is the importer's retry — it never
    // saw our ack. Re-ack instead of ignoring, or their spinner never moves off
    // 'dialing' and the pull dies at the ack timeout with the human still
    // staring at an approval prompt.
    if (pendings.has(msg.requestId)) {
      sendSafe(channelId(), { v: 1, kind: 'pull-received', requestId: msg.requestId })
      return
    }
    const store = loadState()
    const share = store.shares.find((s) => s.id === shareId)
    if (!share || share.projectUuid !== msg.projectUuid) {
      refuse(channelId(), msg.requestId, 'this room does not serve that project')
      return
    }
    // The start-of-serving gate (DOC-30): expiry and revocation refuse new
    // requests; requests already pending ride out expiry (not revocation).
    const status = shareStatus(share, nowIso())
    if (status !== 'active') {
      refuse(channelId(), msg.requestId, `share ${status}`)
      return
    }
    if (!store.projects.some((p) => p.id === share.projectId)) {
      refuse(channelId(), msg.requestId, 'the shared project no longer exists')
      return
    }
    pendings.set(msg.requestId, {
      id: msg.requestId,
      shareId,
      channelId: channelId(),
      requestedAt: nowMs(),
      expiresAt: nowMs() + requestTtlMs,
    })
    sendSafe(channelId(), { v: 1, kind: 'pull-received', requestId: msg.requestId })
  }

  /** One tick at a time: joining is async, and a second pass would double-join. */
  async function tick(): Promise<void> {
    if (stopped || ticking) return
    ticking = true
    try {
      await runTick()
    } finally {
      ticking = false
    }
  }

  async function runTick(): Promise<void> {
    const manager = channels()

    // Sweep pending requests: gone when their channel died, expired when the
    // human never answered — either way nothing transfers.
    for (const [id, p] of [...pendings]) {
      if (!manager || manager.get(p.channelId)?.state !== 'joined') {
        pendings.delete(id)
        continue
      }
      if (nowMs() >= p.expiresAt) {
        sendSafe(p.channelId, { v: 1, kind: 'pull-expired', requestId: id })
        pendings.delete(id)
      }
    }

    if (!manager) return // no relay configured — sync is off on this machine

    // Presence: one joined channel per active share, in the room this side
    // serves — the creator serves the main room, the importer the reverse one,
    // so pulls work in both directions (shares.ts serveRoom).
    const store = loadState()
    for (const share of store.shares) {
      const room = serveRoom(share)
      if (!room) continue // pre-two-way record: nothing to serve from this side yet
      const active = shareStatus(share, nowIso()) === 'active' && store.projects.some((p) => p.id === share.projectId)
      const conn = conns.get(share.id)
      const channelId = conn?.channelId
      const state = channelId ? manager.get(channelId)?.state : undefined
      if (!active) {
        // Leave, unless something is still in flight: a pending request may be
        // mid-approval (in-flight pulls complete across expiry), or a peer may
        // be mid-conversation and owed the refusal the gate has for them.
        const heard = lastHeard.get(share.id) ?? 0
        const busy = hasPendingOn(channelId ?? '') || nowMs() - heard < inactiveLingerMs
        if (channelId && !busy) {
          manager.close(channelId)
          conns.delete(share.id)
          lastHeard.delete(share.id)
        }
        continue
      }
      if (conn && conn.roomId !== room.roomId) {
        // The share was re-armed: leave the rotated-away room and take the new
        // one below, so the link that was just handed out is the one served.
        manager.close(conn.channelId)
        conns.delete(share.id)
        lastHeard.delete(share.id)
      } else if (state === 'joining' || state === 'joined') {
        continue
      }
      conns.set(share.id, { roomId: room.roomId, channelId: manager.join({
        roomId: room.roomId,
        roomSecret: room.roomSecret,
        onMessage: (msg) => {
          // Any readable frame means a peer holding this room's secret is on
          // the topic — that, not the share clock, is what the linger above
          // measures.
          lastHeard.set(share.id, nowMs())
          handleMessage(share.id, () => conns.get(share.id)?.channelId ?? '', msg)
        },
      }).id })
      if (stopped) return
    }
  }

  const hasPendingOn = (channelId: string) =>
    [...pendings.values()].some((p) => p.channelId === channelId)

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
      const manager = channels()
      const store = loadState()
      const share = store.shares.find((s) => s.id === p.shareId)
      if (!share) {
        pendings.delete(requestId)
        throw new PullAnswerError('the share no longer exists', 409)
      }
      // Revocation is a hard stop; expiry is not — this request arrived while
      // the link was alive, and in-flight pulls complete (DOC-30).
      if (shareStatus(share, nowIso()) === 'revoked') {
        refuse(p.channelId, requestId, 'share revoked')
        pendings.delete(requestId)
        throw new PullAnswerError('share revoked — stop-sharing halts serving immediately', 409)
      }
      if (!manager || manager.get(p.channelId)?.state !== 'joined') {
        pendings.delete(requestId)
        throw new PullAnswerError('the requester is no longer connected', 409)
      }
      const snapshot = await assembleSyncSnapshot(store, share, nowIso())
      // Sequentially, and awaited: with broadcast acks on, each send resolves
      // only once the relay has taken the frame, which doubles as flow control
      // against the project's messages-per-second quota. A frame that fails
      // fails the approval — better a visible error than half a board.
      for (const frame of snapshotFrames(requestId, JSON.stringify(snapshot))) {
        await manager.send(p.channelId, frame)
      }
      pendings.delete(requestId)
    },
    deny(requestId) {
      const p = pendings.get(requestId)
      if (!p) throw new PullAnswerError(`unknown pull request: ${requestId}`, 404)
      sendSafe(p.channelId, { v: 1, kind: 'pull-denied', requestId })
      pendings.delete(requestId)
    },
    async announceRevoked(share, reason = 'share revoked') {
      const manager = channels()
      if (!manager) return
      // Say it on the channel we already serve, so a peer waiting on us hears
      // the reason; then drop it so nothing answers for this share again.
      const conn = conns.get(share.id)
      if (conn && manager.get(conn.channelId)?.state === 'joined') {
        await manager.send(conn.channelId, { v: 1, kind: 'room-closed', reason }).catch(() => {})
        manager.close(conn.channelId)
      }
      conns.delete(share.id)
      lastHeard.delete(share.id)
      // And on the room the OTHER side serves, in case they are the ones
      // waiting there — a short-lived join purely to deliver the notice.
      const peerRoom = share.side === 'creator'
        ? { roomId: share.reverseRoomId, roomSecret: share.reverseRoomSecret }
        : { roomId: share.roomId, roomSecret: share.roomSecret }
      if (!peerRoom.roomId) return
      await new Promise<void>((resolve) => {
        const id = manager.join({
          roomId: peerRoom.roomId,
          roomSecret: peerRoom.roomSecret,
          onJoined: () => {
            void manager.send(id, { v: 1, kind: 'room-closed', reason })
              .catch(() => {})
              .finally(() => {
                manager.close(id)
                resolve()
              })
          },
        }).id
        // Never let stop-sharing hang on a relay that won't answer: the local
        // revocation has already taken effect, this is only the courtesy note.
        setTimeout(() => {
          try {
            manager.close(id)
          } catch {}
          resolve()
        }, 5_000).unref?.()
      })
    },
    stop() {
      stopped = true
      const manager = channels()
      for (const { channelId } of conns.values()) {
        try {
          manager?.close(channelId)
        } catch {}
      }
      conns.clear()
      lastHeard.clear()
      pendings.clear()
    },
  }
}

/** The server process's one sync server, driven by the sync-serve plugin. */
let singleton: SyncServer | undefined
export function useSyncServer(): SyncServer {
  singleton ??= createSyncServer({
    channels: useChannelManager,
    loadState: loadStore,
    requestTtlMs: pullRequestTtlMs(),
  })
  return singleton
}

/** Whether this machine can serve at all — the revoke path checks before announcing. */
export function syncServingEnabled(): boolean {
  return syncRelayConfig() !== null
}
