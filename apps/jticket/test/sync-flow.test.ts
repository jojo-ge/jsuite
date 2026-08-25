import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { startLocalRelay, type LocalRelay } from '@jsuite/relay'
import { createPeerManager, type DialOptions, type PeerManager, type PeerStatus } from '../server/utils/peer'
import { createSyncServer, type SyncServer } from '../server/utils/syncServe'
import { createSyncPuller, type SyncPuller } from '../server/utils/syncPull'
import type { SyncSnapshot } from '../server/utils/sync'
import type { Store, Ticket, Project } from '../server/utils/store'
import type { Share } from '../server/utils/shares'
import { waitFor } from './helpers'

// The pull flow, in one process (TICK-294): a sync server (the serving side's
// presence loop + pending approvals) and a sync puller (the importer's Sync
// click) talk over real data channels through the local relay. Stores are
// in-memory; the importer's apply is a spy — performSyncApply's real IO is the
// two-instance e2e's job.

let relay: LocalRelay
let servePeers: PeerManager
let pullPeers: PeerManager
let server: SyncServer | undefined
let puller: SyncPuller | undefined
let tickTimer: ReturnType<typeof setInterval> | undefined

beforeAll(async () => {
  relay = await startLocalRelay()
})

afterAll(async () => {
  await relay.dispose()
})

afterEach(() => {
  if (tickTimer) clearInterval(tickTimer)
  tickTimer = undefined
  server?.stop()
  puller?.stop()
  servePeers?.closeAll()
  pullPeers?.closeAll()
})

function emptyStore(): Store {
  return { projects: [], tickets: [], docs: [], prs: [], repos: [], shares: [], counters: { project: 0, ticket: 0, doc: 0, pr: 0 } }
}

const ts = () => new Date().toISOString()

function makeTicket(overrides: Partial<Ticket>): Ticket {
  const at = ts()
  return {
    id: `tick_${Math.random().toString(36).slice(2)}`,
    key: 'TICK-1',
    title: 'a ticket',
    description: '',
    acceptanceCriteria: [],
    type: 'AFK',
    status: 'todo',
    projectId: null,
    assignee: '',
    labels: [],
    resolution: '',
    blockedBy: [],
    comments: [],
    branch: '',
    completedAt: null,
    origin: '',
    owner: '',
    transfer: '',
    transferAt: '',
    createdAt: at,
    updatedAt: at,
    ...overrides,
  }
}

interface Fixture {
  creatorStore: Store
  importerStore: Store
  creatorShare: Share
  importerShare: Share
  creatorProject: Project
  importerProject: Project
}

/** A shared pair: creator serves project P, importer holds the imported twin. */
function makeFixture({ expiresInMs = 60 * 60 * 1000 } = {}): Fixture {
  const at = ts()
  const expiresAt = new Date(Date.now() + expiresInMs).toISOString()
  const projectUuid = randomUUID()
  const roomId = `room-${randomUUID()}`
  const roomSecret = `secret-${randomUUID()}`
  const reverseRoomId = `room-${randomUUID()}`
  const reverseRoomSecret = `secret-${randomUUID()}`

  const creatorStore = emptyStore()
  const creatorProject: Project = {
    id: 'proj_creator',
    key: 'PROJ-1',
    title: 'Cart rework',
    description: 'the plan',
    mode: 'standard',
    repo: '/home/creator/code/cart',
    integrationBranch: 'proj/cart',
    starred: false,
    share: { key: 'AB', side: 'creator', peerName: 'Blake' },
    createdAt: at,
    updatedAt: at,
  }
  const creatorShare: Share = {
    id: 'share_creator',
    projectId: creatorProject.id,
    projectUuid,
    sharedKey: 'AB',
    roomId,
    roomSecret,
    reverseRoomId,
    reverseRoomSecret,
    side: 'creator',
    expiresAt,
    revokedAt: null,
    createdAt: at,
    updatedAt: at,
  }
  creatorStore.projects.push(creatorProject)
  creatorStore.shares.push(creatorShare)
  creatorStore.tickets.push(
    makeTicket({ id: 'tick_a1', key: 'TICK-1', title: 'first ticket', projectId: creatorProject.id, description: 'd'.repeat(40_000) }),
    makeTicket({ id: 'tick_a2', key: 'TICK-2', title: 'second ticket', projectId: creatorProject.id }),
  )
  creatorStore.counters.ticket = 2

  const importerStore = emptyStore()
  const importerProject: Project = {
    id: 'proj_importer',
    key: 'PROJ-1',
    title: 'AB — shared by Avery',
    description: '',
    mode: 'standard',
    repo: '',
    integrationBranch: '',
    starred: false,
    share: { key: 'AB', side: 'importer', peerName: 'Avery' },
    createdAt: at,
    updatedAt: at,
  }
  const importerShare: Share = {
    id: 'share_importer',
    projectId: importerProject.id,
    projectUuid,
    sharedKey: 'AB',
    roomId,
    roomSecret,
    reverseRoomId,
    reverseRoomSecret,
    side: 'importer',
    expiresAt,
    revokedAt: null,
    createdAt: at,
    updatedAt: at,
  }
  importerStore.projects.push(importerProject)
  importerStore.shares.push(importerShare)

  return { creatorStore, importerStore, creatorShare, importerShare, creatorProject, importerProject }
}

interface Applied {
  projectId: string
  snapshot: SyncSnapshot
}

function startPair(
  fixture: Fixture,
  { requestTtlMs = 30_000, timeoutMs = 30_000, applyError = '', reverse = false } = {},
) {
  // reverse runs the same pair the other way around: the importer's machine
  // serves, the creator's pulls — the transfer protocol needs both directions.
  const serveStore = reverse ? fixture.importerStore : fixture.creatorStore
  const pullStore = reverse ? fixture.creatorStore : fixture.importerStore
  servePeers = createPeerManager()
  pullPeers = createPeerManager()
  const applied: Applied[] = []
  server = createSyncServer({
    peers: servePeers,
    relayUrl: () => relay.url.href,
    loadState: () => serveStore,
    requestTtlMs,
    // Short handshake reclaim: transient WebRTC failures recover fast enough
    // to stay inside the suite's wait windows.
    handshakeTimeoutMs: 3_000,
    // Both ends are this process, so keep ICE on loopback — self-connections
    // over real interfaces flake with EADDRNOTAVAIL mid-DTLS under suite-wide
    // load (TICK-300; this suite's residual flake was TICK-308).
    bindAddress: '127.0.0.1',
  })
  puller = createSyncPuller({
    peers: pullPeers,
    relayUrl: () => relay.url.href,
    loadState: () => pullStore,
    timeoutMs,
    handshakeTimeoutMs: 3_000,
    bindAddress: '127.0.0.1',
    applySnapshot: async (projectId, snapshot) => {
      if (applyError) throw new Error(applyError)
      applied.push({ projectId, snapshot })
      return {
        summary: {
          projectChanged: true,
          tickets: { added: ['AB-1'], changed: [], deleted: [] },
          docs: { added: [], changed: [], deleted: [] },
          comments: { added: 0, changed: 0, deleted: 0 },
        },
        dropped: [],
      }
    },
  })
  tickTimer = setInterval(() => void server!.tick(), 100)
  return { applied }
}

const terminal = (state: string) => ['applied', 'denied', 'expired', 'failed'].includes(state)

describe('pull flow — request, approve, snapshot, apply', () => {
  it('serves an approved pull and the importer applies the snapshot', async () => {
    const fixture = makeFixture()
    const { applied } = startPair(fixture)

    const attempt = puller!.start(fixture.importerProject.id)
    expect(attempt.state).toBe('dialing')

    const pending = await waitFor(() => server!.pending(), (p) => p.length === 1, { label: 'pending approval' })
    expect(pending[0]!.requester).toBe('Blake')
    expect(pending[0]!.projectKey).toBe('PROJ-1')
    expect(pending[0]!.projectTitle).toBe('Cart rework')
    expect(pending[0]!.id).toBe(attempt.id)

    await server!.approve(attempt.id)
    const done = await waitFor(() => puller!.get(attempt.id), (a) => terminal(a.state), { label: 'pull applied' })
    expect(done.state).toBe('applied')
    expect(done.summary?.tickets.added).toEqual(['AB-1'])

    expect(applied).toHaveLength(1)
    const snapshot = applied[0]!.snapshot
    expect(applied[0]!.projectId).toBe(fixture.importerProject.id)
    expect(snapshot.sharedKey).toBe('AB')
    expect(snapshot.side).toBe('creator')
    expect(snapshot.projectMeta?.title).toBe('Cart rework')
    expect(snapshot.tickets.map((t) => t.title).sort()).toEqual(['first ticket', 'second ticket'])
    // The 40k description forced multiple chunks and still round-tripped.
    expect(snapshot.tickets.find((t) => t.id === 'tick_a1')?.description).toBe('d'.repeat(40_000))
    // Machine-local fields never left the creator.
    expect(JSON.stringify(snapshot)).not.toContain('/home/creator/code/cart')
    expect(JSON.stringify(snapshot)).not.toContain('proj/cart')

    // The serving side re-arms its presence, so a second pull works.
    const again = puller!.start(fixture.importerProject.id)
    await waitFor(() => server!.pending(), (p) => p.some((x) => x.id === again.id), { label: 'second pending' })
    await server!.approve(again.id)
    const secondDone = await waitFor(() => puller!.get(again.id), (a) => terminal(a.state), { label: 'second pull' })
    expect(secondDone.state).toBe('applied')
    expect(applied).toHaveLength(2)
  })

  it('a denied pull transfers nothing', async () => {
    const fixture = makeFixture()
    const { applied } = startPair(fixture)

    const attempt = puller!.start(fixture.importerProject.id)
    await waitFor(() => server!.pending(), (p) => p.length === 1, { label: 'pending approval' })
    server!.deny(attempt.id)

    const done = await waitFor(() => puller!.get(attempt.id), (a) => terminal(a.state), { label: 'denied' })
    expect(done.state).toBe('denied')
    expect(applied).toHaveLength(0)
    expect(server!.pending()).toHaveLength(0)
  })

  it('an unanswered request expires on both sides and transfers nothing', async () => {
    const fixture = makeFixture()
    const { applied } = startPair(fixture, { requestTtlMs: 400 })

    const attempt = puller!.start(fixture.importerProject.id)
    await waitFor(() => server!.pending(), (p) => p.length === 1, { label: 'pending approval' })

    const done = await waitFor(() => puller!.get(attempt.id), (a) => terminal(a.state), { label: 'expired' })
    expect(done.state).toBe('expired')
    expect(server!.pending()).toHaveLength(0)
    expect(applied).toHaveLength(0)
  })

  it('an expired share cannot start a pull at all', async () => {
    const fixture = makeFixture({ expiresInMs: -1000 })
    startPair(fixture)
    expect(() => puller!.start(fixture.importerProject.id)).toThrowError(/expired/)
  })

  it('a revoked share refuses approval even for an already-pending request', async () => {
    const fixture = makeFixture()
    const { applied } = startPair(fixture)

    const attempt = puller!.start(fixture.importerProject.id)
    await waitFor(() => server!.pending(), (p) => p.length === 1, { label: 'pending approval' })

    fixture.creatorShare.revokedAt = ts()
    await expect(server!.approve(attempt.id)).rejects.toThrowError(/revoked/)

    const done = await waitFor(() => puller!.get(attempt.id), (a) => terminal(a.state), { label: 'refused' })
    expect(done.state).toBe('failed')
    expect(done.reason).toContain('revoked')
    expect(applied).toHaveLength(0)
  })

  it('a request naming the wrong project uuid is refused', async () => {
    const fixture = makeFixture()
    const { applied } = startPair(fixture)
    fixture.importerShare.projectUuid = 'not-the-shared-project'

    const attempt = puller!.start(fixture.importerProject.id)
    const done = await waitFor(() => puller!.get(attempt.id), (a) => terminal(a.state), { label: 'refused' })
    expect(done.state).toBe('failed')
    expect(server!.pending()).toHaveLength(0)
    expect(applied).toHaveLength(0)
  })

  it('the reverse direction serves too: the creator pulls the importer half over the reverse room', async () => {
    const fixture = makeFixture()
    fixture.importerStore.tickets.push(
      makeTicket({ id: 'tick_b2', key: 'AB-2', title: 'importer ticket', projectId: fixture.importerProject.id, origin: 'importer', owner: 'importer' }),
    )
    const { applied } = startPair(fixture, { reverse: true })

    const attempt = puller!.start(fixture.creatorProject.id)
    const pending = await waitFor(() => server!.pending(), (p) => p.length === 1, { label: 'pending on the importer side' })
    // The serving side names the requester from ITS project.share.peerName.
    expect(pending[0]!.requester).toBe('Avery')
    expect(pending[0]!.id).toBe(attempt.id)

    await server!.approve(attempt.id)
    const done = await waitFor(() => puller!.get(attempt.id), (a) => terminal(a.state), { label: 'reverse pull applied' })
    expect(done.state).toBe('applied')

    expect(applied).toHaveLength(1)
    expect(applied[0]!.projectId).toBe(fixture.creatorProject.id)
    expect(applied[0]!.snapshot.side).toBe('importer')
    expect(applied[0]!.snapshot.projectMeta).toBeNull()
    expect(applied[0]!.snapshot.tickets.map((t) => t.title)).toEqual(['importer ticket'])
  })

  it('a share without a reverse room refuses a creator-side pull with a re-share hint', async () => {
    const fixture = makeFixture()
    fixture.creatorShare.reverseRoomId = ''
    fixture.creatorShare.reverseRoomSecret = ''
    startPair(fixture, { reverse: true })
    expect(() => puller!.start(fixture.creatorProject.id)).toThrowError(/re-share/)
  })

  it('an apply failure surfaces as a failed pull', async () => {
    const fixture = makeFixture()
    startPair(fixture, { applyError: 'disk full' })

    const attempt = puller!.start(fixture.importerProject.id)
    await waitFor(() => server!.pending(), (p) => p.length === 1, { label: 'pending approval' })
    await server!.approve(attempt.id)

    const done = await waitFor(() => puller!.get(attempt.id), (a) => terminal(a.state), { label: 'failed apply' })
    expect(done.state).toBe('failed')
    expect(done.reason).toContain('disk full')
  })
})

// The presence loop's own arithmetic on the room's two member slots. The
// serving side is entitled to exactly one of them; taking both is what locked
// the importer out with 'room full' under load (TICK-311). Both paths to two
// dials are exercised against a counting stub — no relay, no handshake, just
// what tick() decides to dial.

describe('presence loop — one member slot per share', () => {
  function countingPeers(status: Partial<PeerStatus> = {}) {
    const dials: DialOptions[] = []
    const state: PeerStatus = {
      id: 'peer_1', state: 'closed', reason: '', signalingClosed: true, ...status,
    }
    const peers: PeerManager = {
      dial(options) {
        dials.push(options)
        return { id: state.id }
      },
      get: () => (dials.length ? state : undefined),
      send: () => {},
      close: () => {},
      closeAll: () => {},
    }
    return { peers, dials, state }
  }

  // The window the gate waits out, named here rather than inherited from the
  // module's default so the clock arithmetic below reads against it.
  const RECLAIM_GRACE_MS = 2_000

  function serverOver(store: Store, peers: PeerManager, nowMs: () => number) {
    return createSyncServer({
      peers,
      relayUrl: () => relay.url.href,
      loadState: () => store,
      reclaimGraceMs: RECLAIM_GRACE_MS,
      nowMs,
    })
  }

  it('ticks that overlap the relay round-trip dial the room once, not once each', async () => {
    const fixture = makeFixture()
    const { peers, dials } = countingPeers()
    // No await between them: the second enters while the first is suspended
    // on ensureRelayRoom, exactly as an interval driver produces.
    const s = serverOver(fixture.creatorStore, peers, Date.now)
    await Promise.all([s.tick(), s.tick(), s.tick()])
    expect(dials).toHaveLength(1)
    s.stop()
  })

  it('waits for the relay to reclaim a closed dial before re-dialing its room', async () => {
    const fixture = makeFixture()
    const { peers, dials, state } = countingPeers()
    let now = 1_000_000
    const s = serverOver(fixture.creatorStore, peers, () => now)

    await s.tick()
    expect(dials).toHaveLength(1)

    // The dial ended, but the relay has not acknowledged our socket's close —
    // re-dialing now would put both slots in this side's hands.
    state.state = 'closed'
    state.signalingClosed = false
    await s.tick()
    now += RECLAIM_GRACE_MS - 1
    await s.tick()
    expect(dials).toHaveLength(1)

    // Acknowledged: the slot is free and the share re-arms.
    state.signalingClosed = true
    await s.tick()
    expect(dials).toHaveLength(2)
    s.stop()
  })

  it('does not dial after stop(), even when stop lands mid round-trip', async () => {
    const fixture = makeFixture()
    const { peers, dials } = countingPeers()
    const s = serverOver(fixture.creatorStore, peers, Date.now)

    const inFlight = s.tick()
    s.stop()
    await inFlight
    expect(dials).toHaveLength(0)
  })

  it('re-dials anyway once the reclaim grace expires — a lost ack must not strand the share', async () => {
    const fixture = makeFixture()
    const { peers, dials, state } = countingPeers()
    let now = 1_000_000
    const s = serverOver(fixture.creatorStore, peers, () => now)

    await s.tick()
    state.state = 'failed'
    state.signalingClosed = false
    await s.tick()
    expect(dials).toHaveLength(1)

    now += RECLAIM_GRACE_MS
    await s.tick()
    expect(dials).toHaveLength(2)
    s.stop()
  })
})
