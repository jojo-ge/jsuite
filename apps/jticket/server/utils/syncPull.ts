import type { PeerManager } from './peer'
import { usePeerManager } from './peer'
import type { Store } from './store'
import { loadStore } from './store'
import { pullRoom, shareIsExpired } from './shares'
import { ensureRelayRoom } from './relayRooms'
import { performSyncApply } from './syncIo'
import type { SyncChangeSummary, SyncSnapshot } from './sync'
import { SnapshotAssembler, encodeWireMessage, parseWireMessage } from './syncWire'
import { handshakeTimeoutMs as configHandshakeTimeoutMs, pullTimeoutMs, syncRelayUrl } from './syncConfig'

// The importing side of the pull flow (TICK-294, spec DOC-30): one Sync click
// is one attempt — dial the share's room as initiator, send the request, wait
// for the human on the other side, reassemble the snapshot, apply it. The
// endpoint polls get() for progress; every terminal state carries a reason.

export type PullState = 'dialing' | 'awaiting-approval' | 'applying' | 'applied' | 'denied' | 'expired' | 'failed'

const TERMINAL: ReadonlySet<PullState> = new Set(['applied', 'denied', 'expired', 'failed'])

export interface PullAttemptView {
  id: string
  projectId: string
  state: PullState
  /** Why the attempt ended ('' while running and on success). */
  reason: string
  /** The change summary — set once state is 'applied'. */
  summary: SyncChangeSummary | null
  /** Incoming entities the apply refused (see sync.ts). */
  dropped: string[]
  startedAt: string
}

/** A refusal to even start the attempt, with the HTTP status it maps to. */
export class PullStartError extends Error {
  constructor(message: string, public readonly statusCode: number) {
    super(message)
  }
}

export interface SyncPullerOptions {
  peers: PeerManager
  relayUrl: () => string
  loadState: () => Store
  applySnapshot: (projectId: string, snapshot: SyncSnapshot) => Promise<{ summary: SyncChangeSummary; dropped: string[] }>
  timeoutMs?: number
  handshakeTimeoutMs?: number
  /**
   * Local address to bind ICE to (see DialOptions.bindAddress). Unset in
   * production — real pulls cross machines. In-process tests bind 127.0.0.1
   * so self-connections stay off real interfaces (TICK-300's EADDRNOTAVAIL).
   */
  bindAddress?: string
  nowMs?: () => number
}

export interface SyncPuller {
  /** Kick off a pull for a shared project (id or key); throws PullStartError. */
  start(projectRef: string): PullAttemptView
  get(id: string): PullAttemptView | undefined
  stop(): void
}

interface Attempt extends PullAttemptView {
  peerId: string
  timer: ReturnType<typeof setTimeout> | null
}

let nextAttempt = 1

export function createSyncPuller(options: SyncPullerOptions): SyncPuller {
  const { peers, relayUrl, loadState, applySnapshot, timeoutMs = 180_000, handshakeTimeoutMs, bindAddress, nowMs = Date.now } = options
  const attempts = new Map<string, Attempt>()

  const view = (a: Attempt): PullAttemptView => ({
    id: a.id,
    projectId: a.projectId,
    state: a.state,
    reason: a.reason,
    summary: a.summary,
    dropped: [...a.dropped],
    startedAt: a.startedAt,
  })

  function start(projectRef: string): PullAttemptView {
    const store = loadState()
    const project = store.projects.find((p) => p.id === projectRef || p.key === projectRef)
    if (!project) throw new PullStartError('project not found', 404)
    const share = store.shares.find((s) => s.projectId === project.id)
    if (!share) throw new PullStartError('project is not shared', 409)
    // Either side pulls — each dials the room the OTHER side serves. A record
    // from before two-way sync has no reverse room, so the creator direction
    // can't dial until the pair re-shares and re-imports a fresh link.
    const room = pullRoom(share)
    if (!room) {
      throw new PullStartError('this share predates two-way sync — re-share and re-import a fresh link to pull from this side', 409)
    }
    if (shareIsExpired(share, new Date(nowMs()).toISOString())) {
      throw new PullStartError('share link expired — ask your coworker for a fresh link', 410)
    }
    const url = relayUrl()
    if (!url) {
      throw new PullStartError(
        'no signaling relay configured — run packages/relay/wizard.sh (or set JTICKET_RELAY_URL)',
        503,
      )
    }

    const id = `pull_${nextAttempt++}_${nowMs().toString(36)}`
    const attempt: Attempt = {
      id,
      projectId: project.id,
      state: 'dialing',
      reason: '',
      summary: null,
      dropped: [],
      startedAt: new Date(nowMs()).toISOString(),
      peerId: '',
      timer: null,
    }
    attempts.set(id, attempt)
    const assembler = new SnapshotAssembler(id)

    const finish = (state: PullState, reason = '') => {
      if (TERMINAL.has(attempt.state)) return
      attempt.state = state
      attempt.reason = reason
      if (attempt.timer) clearTimeout(attempt.timer)
      attempt.timer = null
      if (attempt.peerId) {
        try {
          peers.close(attempt.peerId)
        } catch {}
      }
    }

    const handleMessage = (raw: string) => {
      const msg = parseWireMessage(raw)
      if (!msg || TERMINAL.has(attempt.state)) return
      if (msg.kind === 'serve-ready') {
        // The serving side is listening — safe to ask now (sending on open
        // would race the far side's handler attachment on a fresh channel).
        if (attempt.state !== 'dialing') return
        try {
          peers.send(
            attempt.peerId,
            encodeWireMessage({ v: 1, kind: 'pull-request', requestId: id, projectUuid: share.projectUuid }),
          )
          attempt.state = 'awaiting-approval'
        } catch (error) {
          finish('failed', error instanceof Error ? error.message : String(error))
        }
        return
      }
      if (msg.requestId !== id) return
      switch (msg.kind) {
        case 'pull-denied':
          finish('denied', 'the pull was denied')
          return
        case 'pull-refused':
          finish('failed', msg.reason)
          return
        case 'pull-expired':
          finish('expired', 'the request expired unanswered')
          return
        case 'snapshot-chunk': {
          if (!assembler.add(msg) || attempt.state === 'applying') return
          attempt.state = 'applying'
          void (async () => {
            try {
              const snapshot = JSON.parse(assembler.json()) as SyncSnapshot
              const { summary, dropped } = await applySnapshot(project.id, snapshot)
              attempt.summary = summary
              attempt.dropped = dropped
              attempt.state = 'applied'
            } catch (error) {
              attempt.state = 'failed'
              attempt.reason = `apply failed: ${error instanceof Error ? error.message : String(error)}`
            } finally {
              if (attempt.timer) clearTimeout(attempt.timer)
              attempt.timer = null
              try {
                peers.close(attempt.peerId)
              } catch {}
            }
          })()
          return
        }
      }
    }

    // A failed handshake before the request went out is transient (WebRTC
    // dials do fail; the serving side's presence loop re-dials on its side
    // too) — retry with a fresh handshake, bounded, under the overall timeout.
    let redials = 5
    const dial = () => {
      if (TERMINAL.has(attempt.state)) return
      attempt.peerId = peers.dial({
        relayUrl: url,
        roomId: room.roomId,
        secret: room.roomSecret,
        initiator: true,
        ...(handshakeTimeoutMs ? { handshakeTimeoutMs } : {}),
        ...(bindAddress ? { bindAddress } : {}),
        onMessage: handleMessage,
        onClose: () => {
          if (TERMINAL.has(attempt.state) || attempt.state === 'applying') return
          const status = peers.get(attempt.peerId)
          if (attempt.state === 'dialing' && redials > 0) {
            redials--
            setTimeout(dial, 300)
            return
          }
          finish('failed', status?.reason || 'the connection closed before the pull completed')
        },
      }).id
    }

    attempt.timer = setTimeout(() => finish('expired', 'no answer before the timeout'), timeoutMs)
    void (async () => {
      try {
        await ensureRelayRoom(url, room, nowMs)
      } catch (error) {
        finish('failed', error instanceof Error ? error.message : String(error))
        return
      }
      dial()
    })()

    return view(attempt)
  }

  return {
    start,
    get(id) {
      const attempt = attempts.get(id)
      return attempt && view(attempt)
    },
    stop() {
      for (const attempt of attempts.values()) {
        if (attempt.timer) clearTimeout(attempt.timer)
        attempt.timer = null
      }
    },
  }
}

/** The server process's one puller, shared by the pull endpoints. */
let singleton: SyncPuller | undefined
export function useSyncPuller(): SyncPuller {
  singleton ??= createSyncPuller({
    peers: usePeerManager(),
    relayUrl: syncRelayUrl,
    loadState: loadStore,
    applySnapshot: performSyncApply,
    timeoutMs: pullTimeoutMs(),
    handshakeTimeoutMs: configHandshakeTimeoutMs(),
  })
  return singleton
}
