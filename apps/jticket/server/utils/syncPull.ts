import type { ChannelManager } from './syncChannel'
import { useChannelManager } from './syncChannel'
import type { Store } from './store'
import { loadStore } from './store'
import { pullRoom, shareIsExpired } from './shares'
import { performSyncApply } from './syncIo'
import type { SyncChangeSummary, SyncSnapshot } from './sync'
import { SnapshotAssembler } from './syncWire'
import { pullAckTimeoutMs, pullRetryMs, pullTimeoutMs, syncRelayConfig } from './syncConfig'

// The importing side of the pull flow (TICK-294, spec DOC-30): one Sync click
// is one attempt — join the share's channel, ask, wait for the human on the
// other side, reassemble the snapshot, apply it. The endpoint polls get() for
// progress; every terminal state carries a reason.
//
// Since sync moved off WebRTC (TICK-3xx) the request is re-sent until it is
// acknowledged rather than dialed until a handshake sticks. A broadcast topic
// delivers to whoever is joined *now*, so a request sent before the serving
// side joins is simply not heard — the retry, not a redial, is what closes
// that window. Silence past the ack timeout means nobody is home, which is a
// far more common and more explicable failure than a failed ICE negotiation.

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
  /** Null when no relay is configured; start() then refuses with a 503. */
  channels: () => ChannelManager | null
  loadState: () => Store
  applySnapshot: (projectId: string, snapshot: SyncSnapshot) => Promise<{ summary: SyncChangeSummary; dropped: string[] }>
  timeoutMs?: number
  /** How long to wait for the serving side to acknowledge the request. */
  ackTimeoutMs?: number
  /** How often an unacknowledged request is re-sent. */
  retryMs?: number
  nowMs?: () => number
}

export interface SyncPuller {
  /** Kick off a pull for a shared project (id or key); throws PullStartError. */
  start(projectRef: string): PullAttemptView
  get(id: string): PullAttemptView | undefined
  stop(): void
}

interface Attempt extends PullAttemptView {
  channelId: string
  timer: ReturnType<typeof setTimeout> | null
  ackTimer: ReturnType<typeof setTimeout> | null
  retryTimer: ReturnType<typeof setInterval> | null
}

let nextAttempt = 1

export function createSyncPuller(options: SyncPullerOptions): SyncPuller {
  const {
    channels, loadState, applySnapshot,
    timeoutMs = 180_000, ackTimeoutMs = 25_000, retryMs = 2_000, nowMs = Date.now,
  } = options
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
    // Either side pulls — each joins the room the OTHER side serves. A record
    // from before two-way sync has no reverse room, so the creator direction
    // can't pull until the pair re-shares and re-imports a fresh link.
    const room = pullRoom(share)
    if (!room) {
      throw new PullStartError('this share predates two-way sync — re-share and re-import a fresh link to pull from this side', 409)
    }
    if (shareIsExpired(share, new Date(nowMs()).toISOString())) {
      throw new PullStartError('share link expired — ask your coworker for a fresh link', 410)
    }
    const manager = channels()
    if (!manager) {
      throw new PullStartError(
        'no sync relay configured — run packages/relay/wizard.sh (or set JTICKET_SUPABASE_URL and JTICKET_SUPABASE_KEY)',
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
      channelId: '',
      timer: null,
      ackTimer: null,
      retryTimer: null,
    }
    attempts.set(id, attempt)
    const assembler = new SnapshotAssembler(id)

    const clearTimers = () => {
      if (attempt.timer) clearTimeout(attempt.timer)
      if (attempt.ackTimer) clearTimeout(attempt.ackTimer)
      if (attempt.retryTimer) clearInterval(attempt.retryTimer)
      attempt.timer = attempt.ackTimer = null
      attempt.retryTimer = null
    }

    const finish = (state: PullState, reason = '') => {
      if (TERMINAL.has(attempt.state)) return
      attempt.state = state
      attempt.reason = reason
      clearTimers()
      if (attempt.channelId) {
        try {
          manager.close(attempt.channelId)
        } catch {}
      }
    }

    /** Stop retrying and stop the ack clock — the far side has answered. */
    const acknowledged = () => {
      if (attempt.retryTimer) clearInterval(attempt.retryTimer)
      if (attempt.ackTimer) clearTimeout(attempt.ackTimer)
      attempt.retryTimer = null
      attempt.ackTimer = null
    }

    const ask = () => {
      if (attempt.state !== 'dialing') return
      void manager.send(attempt.channelId, {
        v: 1, kind: 'pull-request', requestId: id, projectUuid: share.projectUuid,
      }).catch(() => {}) // a send that fails is just an unheard retry; the clock rules
    }

    const handleMessage = (msg: import('./syncWire').PullWireMessage) => {
      if (TERMINAL.has(attempt.state)) return
      if (msg.kind === 'room-closed') {
        // Only meaningful while we are still waiting; a notice arriving
        // mid-transfer would be a different share's, and in-flight completes.
        if (attempt.state === 'dialing' || attempt.state === 'awaiting-approval') {
          finish('failed', msg.reason || 'your coworker stopped sharing this project')
        }
        return
      }
      if (msg.requestId !== id) return
      switch (msg.kind) {
        case 'pull-received':
          if (attempt.state !== 'dialing') return
          acknowledged()
          attempt.state = 'awaiting-approval'
          return
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
          // Chunks can outrun the ack on a lossy channel — an approval that
          // beats us here still means the far side heard the request.
          acknowledged()
          if (attempt.state === 'dialing') attempt.state = 'awaiting-approval'
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
              clearTimers()
              try {
                manager.close(attempt.channelId)
              } catch {}
            }
          })()
          return
        }
      }
    }

    attempt.timer = setTimeout(() => finish('expired', 'no answer before the timeout'), timeoutMs)
    attempt.ackTimer = setTimeout(() => {
      finish(
        'failed',
        "your coworker's jTicket never answered — check that their app is running and that the share is still live",
      )
    }, ackTimeoutMs)

    attempt.channelId = manager.join({
      roomId: room.roomId,
      roomSecret: room.roomSecret,
      onJoined: () => {
        ask()
        // Re-ask on a cadence: the serving side may not have joined yet, and
        // a broadcast only reaches who is listening at the moment it is sent.
        attempt.retryTimer = setInterval(ask, retryMs)
        attempt.retryTimer.unref?.()
      },
      onMessage: handleMessage,
      onClose: () => {
        if (TERMINAL.has(attempt.state) || attempt.state === 'applying') return
        finish('failed', manager.get(attempt.channelId)?.reason || 'the connection closed before the pull completed')
      },
    }).id

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
        if (attempt.ackTimer) clearTimeout(attempt.ackTimer)
        if (attempt.retryTimer) clearInterval(attempt.retryTimer)
        attempt.timer = attempt.ackTimer = null
        attempt.retryTimer = null
      }
    },
  }
}

/** The server process's one puller, shared by the pull endpoints. */
let singleton: SyncPuller | undefined
export function useSyncPuller(): SyncPuller {
  singleton ??= createSyncPuller({
    channels: useChannelManager,
    loadState: loadStore,
    applySnapshot: performSyncApply,
    timeoutMs: pullTimeoutMs(),
    ackTimeoutMs: pullAckTimeoutMs(),
    retryMs: pullRetryMs(),
  })
  return singleton
}

/** Whether this machine has a relay wired up at all. */
export function syncPullEnabled(): boolean {
  return syncRelayConfig() !== null
}
