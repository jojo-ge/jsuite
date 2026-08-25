import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { startLocalRelay, type LocalRelay } from '@jsuite/relay'
import { createChannelManager, roomTopic, type ChannelManager } from '../server/utils/syncChannel'
import { createLocalTransport } from '../server/utils/syncTransport'
import { openFrame, roomKey, sealFrame } from '../server/utils/syncCrypto'
import { createSyncServer, type SyncServer } from '../server/utils/syncServe'
import { createSyncPuller, type SyncPuller } from '../server/utils/syncPull'
import type { SyncSnapshot } from '../server/utils/sync'
import type { Doc, Project, Store, Ticket } from '../server/utils/store'
import { serveRoom, type RelayRoomRef, type Share } from '../server/utils/shares'
import { encodeWireMessage, parseWireMessage, type PullWireMessage } from '../server/utils/syncWire'
import { sleep, waitFor } from './helpers'

// TICK-297: the adversarial security & privacy pass over the finished sync
// feature (spec DOC-30). Each test *attacks* one invariant rather than
// exercising a happy path. This half runs in-process — a real sync server, a
// real puller, real channel managers over a local relay — because the attacks
// here need frame-level control the two-instance HTTP surface can't give:
// forging a pull-request for a project the token doesn't serve, watching the
// relay socket for plaintext leaks, capturing the exact snapshot payload.
//
// Since sync moved to a broadcast relay (TICK-3xx) the attacker model changed
// in an important way: joining a room's topic is no longer gated at all —
// anyone who knows the topic name is on it. What confines them is the seal.
// The tests below attack from inside the room accordingly.
// The HTTP-level attacks (revoked/expired links, dispatch refusals post-sync)
// live in sync-security.e2e.test.ts.

// Distinctive markers we plant in the served board and then hunt for in places
// they must never appear (the relay's signaling traffic; the snapshot payload).
const TICKET_SECRET = 'TICKET_BODY_SECRET_a17f93c2'
const DOC_SECRET = 'DOC_TITLE_SECRET_b28e04d3'
const REPO_PATH = '/home/creator/code/secret-cart-repo'
const INTEGRATION_BRANCH = 'proj/secret-integration-branch'
const WORK_BRANCH = 'tick/secret-work-branch'

let relay: LocalRelay
let serveChannels: ChannelManager
let pullChannels: ChannelManager
let attacker: Attacker | undefined
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
  serveChannels?.closeAll()
  pullChannels?.closeAll()
  attacker?.leave()
  attacker = undefined
})

const ts = () => new Date().toISOString()

function emptyStore(): Store {
  return { projects: [], tickets: [], docs: [], prs: [], repos: [], shares: [], counters: { project: 0, ticket: 0, doc: 0, pr: 0 } }
}

function makeTicket(overrides: Partial<Ticket>): Ticket {
  const at = ts()
  return {
    id: `tick_${randomUUID()}`,
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

interface SharedProject {
  project: Project
  share: Share
}

/**
 * A creator-side shared project on a store: the project record (with its
 * machine-local repo/branch set), an active share with a fresh room pair, and
 * whatever tickets/docs the caller planted. This is the *serving* side — the
 * side a pull reads from.
 */
function addSharedProject(
  store: Store,
  { id, key, sharedKey, tickets = [], docs = [] }:
    { id: string; key: string; sharedKey: string; tickets?: Ticket[]; docs?: Doc[] },
): SharedProject {
  const at = ts()
  const project: Project = {
    id,
    key,
    title: 'Cart rework',
    description: 'the plan',
    mode: 'standard',
    repo: REPO_PATH,
    integrationBranch: INTEGRATION_BRANCH,
    starred: false,
    share: { key: sharedKey, side: 'creator', peerName: 'Blake' },
    createdAt: at,
    updatedAt: at,
  }
  const share: Share = {
    id: `share_${id}`,
    projectId: id,
    projectUuid: randomUUID(),
    sharedKey,
    roomId: `room-${randomUUID()}`,
    roomSecret: `secret-${randomUUID()}`,
    reverseRoomId: `room-${randomUUID()}`,
    reverseRoomSecret: `secret-${randomUUID()}`,
    side: 'creator',
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    revokedAt: null,
    createdAt: at,
    updatedAt: at,
  }
  store.projects.push(project)
  store.shares.push(share)
  store.tickets.push(...tickets.map((t) => ({ ...t, projectId: id })))
  store.docs.push(...docs.map((d) => ({ ...d, projectId: id })))
  return { project, share }
}

/** The importer-side twin of a shared project: same UUID + rooms, empty half. */
function addImportedProject(store: Store, source: SharedProject, { id, key }: { id: string; key: string }): SharedProject {
  const at = ts()
  const project: Project = {
    id,
    key,
    title: `${source.share.sharedKey} — shared`,
    description: '',
    mode: 'standard',
    repo: '/home/importer/somewhere-else',
    integrationBranch: 'proj/importer-own-branch',
    starred: false,
    share: { key: source.share.sharedKey, side: 'importer', peerName: 'Avery' },
    createdAt: at,
    updatedAt: at,
  }
  const share: Share = {
    ...source.share,
    id: `share_${id}`,
    projectId: id,
    side: 'importer',
    createdAt: at,
    updatedAt: at,
  }
  store.projects.push(project)
  store.shares.push(share)
  return { project, share }
}

/** Start a serving side + a legit puller wired across the local relay. */
function startPair(serveStore: Store, pullStore: Store) {
  serveChannels = createChannelManager({ kind: 'local', url: relay.url })
  pullChannels = createChannelManager({ kind: 'local', url: relay.url })
  const applied: Array<{ projectId: string; snapshot: SyncSnapshot }> = []
  server = createSyncServer({
    channels: () => serveChannels,
    loadState: () => serveStore,
    requestTtlMs: 30_000,
  })
  puller = createSyncPuller({
    channels: () => pullChannels,
    loadState: () => pullStore,
    timeoutMs: 30_000,
    retryMs: 100,
    applySnapshot: async (projectId, snapshot) => {
      applied.push({ projectId, snapshot })
      return {
        summary: {
          projectChanged: true,
          tickets: { added: snapshot.tickets.map((t) => t.key), changed: [], deleted: [] },
          docs: { added: snapshot.docs.map((d) => d.record.key), changed: [], deleted: [] },
          comments: { added: 0, changed: 0, deleted: 0 },
        },
        dropped: [],
      }
    },
  })
  tickTimer = setInterval(() => void server!.tick(), 100)
  return { applied }
}

/** Start only the serving side — for the raw-frame attacks (no legit puller). */
function startServer(serveStore: Store) {
  serveChannels = createChannelManager({ kind: 'local', url: relay.url })
  server = createSyncServer({
    channels: () => serveChannels,
    loadState: () => serveStore,
    requestTtlMs: 30_000,
  })
  tickTimer = setInterval(() => void server!.tick(), 100)
}

interface Attacker {
  received: PullWireMessage[]
  /** Seal and send a well-formed wire message. */
  send: (message: PullWireMessage) => Promise<void>
  /** Seal and send arbitrary text — readable by the room, not a valid message. */
  sendRaw: (raw: string) => Promise<void>
  /** Send text that is NOT sealed with this room's key at all. */
  sendUnsealed: (raw: string) => Promise<void>
  /**
   * Re-send until the far side answers, the way the real puller does. Nothing
   * announces that the serving side has joined the topic — a frame sent before
   * it does is simply never delivered — so every attack that needs an answer
   * has to keep asking.
   */
  sendUntil: (message: PullWireMessage, done: () => boolean, label: string) => Promise<void>
  kinds: () => PullWireMessage['kind'][]
  firstOf: (kind: PullWireMessage['kind']) => PullWireMessage | undefined
  leave: () => void
}

/**
 * A hostile peer on a room's topic, speaking the wire protocol by hand. It
 * bypasses the channel manager entirely — straight onto the transport with its
 * own key — so it can forge frames the typed API would never emit, seal
 * garbage, or send bytes sealed with the wrong key.
 *
 * `key` defaults to the room's real secret; pass a different one to attack as
 * somebody who found the topic but not the link.
 */
function mountAttacker(room: RelayRoomRef, secret = room.roomSecret): Attacker {
  const key = roomKey(secret)
  const received: PullWireMessage[] = []
  const transport = createLocalTransport(relay.url)
  const topic = transport.join(roomTopic(room.roomId), {
    onJoined: () => {},
    onError: () => {},
    onFrame: (sealed) => {
      const plaintext = openFrame(key, sealed)
      if (plaintext === null) return // not sealed for us — exactly what a stranger sees
      const msg = parseWireMessage(plaintext)
      if (msg) received.push(msg)
    },
  })

  const sendRaw = (raw: string) => topic.send(sealFrame(key, raw))
  const send = (message: PullWireMessage) => sendRaw(encodeWireMessage(message))

  return {
    received,
    send,
    sendRaw,
    sendUnsealed: (raw: string) => topic.send(raw),
    async sendUntil(message, done, label) {
      await waitFor(
        async () => {
          await send(message)
          return done() ? true : undefined
        },
        (v) => v,
        { label, intervalMs: 150, timeoutMs: 20_000 },
      )
    },
    kinds: () => received.map((m) => m.kind),
    firstOf: (kind) => received.find((m) => m.kind === kind),
    leave: () => {
      topic.leave()
      transport.dispose()
    },
  }
}

const terminal = (state: string) => ['applied', 'denied', 'expired', 'failed'].includes(state)

// ── AC 2: a share token reaches only its own project's pull surface ──────────
describe('capability confinement — a share token cannot read beyond its own project', () => {
  it('a request forged for another project over this share\'s room is refused, and nothing transfers', async () => {
    // Two independently-shared projects on the creator. The attacker holds the
    // room credentials for P1 (its own share) and tries to pull P2's data —
    // P2's UUID, sent down P1's room.
    const store = emptyStore()
    const p1 = addSharedProject(store, {
      id: 'proj_p1',
      key: 'PROJ-1',
      sharedKey: 'AA',
      tickets: [makeTicket({ id: 'tick_p1', key: 'AA-1', title: 'p1 ticket', description: 'p1 secret' })],
    })
    const p2 = addSharedProject(store, {
      id: 'proj_p2',
      key: 'PROJ-2',
      sharedKey: 'BB',
      tickets: [makeTicket({ id: 'tick_p2', key: 'BB-1', title: 'p2 ticket', description: 'p2 secret' })],
    })
    startServer(store)

    attacker = mountAttacker(serveRoom(p1.share)!)
    await attacker.sendUntil(
      { v: 1, kind: 'pull-request', requestId: 'atk-1', projectUuid: p2.share.projectUuid },
      () => !!attacker!.firstOf('pull-refused'),
      'refusal',
    )

    const refused = attacker.firstOf('pull-refused')
    expect(refused).toMatchObject({ kind: 'pull-refused', requestId: 'atk-1' })
    expect((refused as { reason: string }).reason).toMatch(/does not serve that project/i)

    // No snapshot ever crossed, and the server never queued the request for a
    // human to approve — the confinement is silent, not merely unapproved.
    await sleep(400)
    expect(attacker.kinds()).not.toContain('snapshot-chunk')
    expect(server!.pending()).toHaveLength(0)
  })

  it('a stranger on the room\'s topic can neither read its traffic nor be heard', async () => {
    // The topic is no longer a door with a lock on it: anyone who learns a
    // room id is on it, and the relay hands them every frame. What confines
    // them is the seal — so this attacker joins the real room with the wrong
    // secret and finds it can do nothing at all.
    const store = emptyStore()
    const p1 = addSharedProject(store, {
      id: 'proj_p1',
      key: 'PROJ-1',
      sharedKey: 'AA',
      tickets: [makeTicket({ id: 'tick_p1', key: 'AA-1', title: 'p1 ticket', description: TICKET_SECRET })],
    })
    startServer(store)

    const room = serveRoom(p1.share)!
    // Same room id, a secret they guessed rather than were given.
    attacker = mountAttacker(room, 'not-the-secret')

    // A legitimate-looking request, sealed with the wrong key: the serving
    // side cannot open it, so it is dropped as noise — no pending approval,
    // and no refusal either (there is nothing to answer).
    for (let i = 0; i < 10; i++) {
      await attacker.send({ v: 1, kind: 'pull-request', requestId: 'atk-w', projectUuid: p1.share.projectUuid })
      await sleep(100)
    }
    expect(server!.pending()).toHaveLength(0)
    expect(attacker.received).toEqual([])

    // Unsealed plaintext fares no better.
    await attacker.sendUnsealed(
      JSON.stringify({ v: 1, kind: 'pull-request', requestId: 'atk-p', projectUuid: p1.share.projectUuid }),
    )
    await sleep(300)
    expect(server!.pending()).toHaveLength(0)

    // Meanwhile a legitimate peer on the same topic is served normally — the
    // room works, this attacker simply isn't in it.
    const legit = mountAttacker(room)
    try {
      await legit.sendUntil(
        { v: 1, kind: 'pull-request', requestId: 'atk-ok', projectUuid: p1.share.projectUuid },
        () => server!.pending().some((p) => p.id === 'atk-ok'),
        'the legitimate request to queue',
      )
      // …and the stranger, sitting on the very same topic throughout, saw
      // none of the traffic that just crossed it.
      expect(attacker.received).toEqual([])
    } finally {
      legit.leave()
    }
  })
})

// ── AC 4: no pull without approval moves any data ────────────────────────────
describe('no data without approval', () => {
  it('a well-formed request the human never approves transfers nothing; a denial transfers nothing', async () => {
    const store = emptyStore()
    const p1 = addSharedProject(store, {
      id: 'proj_p1',
      key: 'PROJ-1',
      sharedKey: 'AA',
      tickets: [makeTicket({ id: 'tick_p1', key: 'AA-1', title: 'p1 ticket', description: TICKET_SECRET })],
    })
    startServer(store)

    attacker = mountAttacker(serveRoom(p1.share)!)
    // A legitimate request for the attacker's OWN shared project.
    // It becomes a pending approval — and stays there. Without a human approve,
    // no snapshot is ever sent.
    await attacker.sendUntil(
      { v: 1, kind: 'pull-request', requestId: 'atk-2', projectUuid: p1.share.projectUuid },
      () => server!.pending().length === 1,
      'pending approval',
    )
    await sleep(500)
    expect(attacker.kinds()).not.toContain('snapshot-chunk')

    // Denying it sends a refusal and still moves no data.
    server!.deny('atk-2')
    await waitFor(() => attacker.firstOf('pull-denied'), (m) => !!m, { label: 'denied' })
    expect(attacker.kinds()).not.toContain('snapshot-chunk')
    expect(server!.pending()).toHaveLength(0)
  })

  it('the serving side is inert to every frame kind except a pull-request', async () => {
    // DOC-30 invariant (a): no remote-originated event drives the serving side.
    // The importer "speaks first and only asks" — so a peer forging other frame
    // kinds, or malformed junk, must move nothing and never crash the server.
    const store = emptyStore()
    const p1 = addSharedProject(store, {
      id: 'proj_p1',
      key: 'PROJ-1',
      sharedKey: 'AA',
      tickets: [makeTicket({ id: 'tick_p1', key: 'AA-1', title: 'p1 ticket', description: TICKET_SECRET })],
    })
    startServer(store)

    attacker = mountAttacker(serveRoom(p1.share)!)
    // Every non-request frame the protocol defines, plus malformed junk — sent
    // repeatedly, since nothing tells us when the serving side is listening and
    // a frame that lands before it joins proves nothing.
    const junk = async () => {
      await attacker!.send({ v: 1, kind: 'pull-received', requestId: 'forged' })
      await attacker!.send({ v: 1, kind: 'snapshot-chunk', requestId: 'forged', seq: 0, total: 1, data: 'give me the board' })
      await attacker!.send({ v: 1, kind: 'pull-denied', requestId: 'forged' })
      await attacker!.send({ v: 1, kind: 'pull-refused', requestId: 'forged', reason: 'x' })
      await attacker!.send({ v: 1, kind: 'room-closed', reason: 'stop serving' })
      await attacker!.sendRaw('{"not":"a wire message"}')
      await attacker!.sendRaw('this is not even json {{{')
    }
    for (let i = 0; i < 8; i++) {
      await junk()
      await sleep(100)
    }

    // None of it created work or produced output.
    expect(server!.pending()).toHaveLength(0)
    expect(attacker.received).toEqual([]) // the serving side said nothing back

    // And the server is still alive: a genuine request still queues.
    await attacker.sendUntil(
      { v: 1, kind: 'pull-request', requestId: 'atk-real', projectUuid: p1.share.projectUuid },
      () => server!.pending().some((x) => x.id === 'atk-real'),
      'still serving',
    )
  })
})

// ── AC 1: an expired share cannot serve, even to an importer that skips its
// own local expiry check ─────────────────────────────────────────────────────
describe('an expired share refuses to serve', () => {
  it('a request arriving after the share expires on an open channel is refused, nothing transfers', async () => {
    // Connect while the share is still alive, then let it lapse and ask: the
    // start-of-serving gate in handleMessage refuses the post-expiry request
    // (in-flight pulls complete, but a NEW request after expiry does not).
    const store = emptyStore()
    const p1 = addSharedProject(store, {
      id: 'proj_p1',
      key: 'PROJ-1',
      sharedKey: 'AA',
      tickets: [makeTicket({ id: 'tick_p1', key: 'AA-1', title: 'p1 ticket', description: TICKET_SECRET })],
    })
    startServer(store)

    // Connect while the share is comfortably alive (no race with the cold-start
    // handshake), then expire it by hand — the server reads the live store each
    // tick. A connected channel survives the lapse (in-flight completes), so the
    // post-expiry request is what actually hits the start-of-serving gate.
    attacker = mountAttacker(serveRoom(p1.share)!)
    // Prove the room is live and being served BEFORE expiring it, so the
    // refusal below is the start-of-serving gate talking and not silence.
    await attacker.sendUntil(
      { v: 1, kind: 'pull-request', requestId: 'atk-live', projectUuid: p1.share.projectUuid },
      () => server!.pending().some((p) => p.id === 'atk-live'),
      'the share to be served',
    )
    server!.deny('atk-live')
    p1.share.expiresAt = new Date(Date.now() - 1_000).toISOString()

    await attacker.send({ v: 1, kind: 'pull-request', requestId: 'atk-exp', projectUuid: p1.share.projectUuid })
    const refused = await waitFor(() => attacker!.firstOf('pull-refused'), (m) => !!m, { label: 'expiry refusal' })
    expect((refused as { reason: string }).reason).toMatch(/expired/i)
    await sleep(300)
    expect(attacker.kinds()).not.toContain('snapshot-chunk')
    expect(server!.pending()).toHaveLength(0)
  })
})

// ── AC 3: relay traffic carries no plaintext project data ────────────────────
describe('the relay is data-blind', () => {
  it('a full approved sync leaves no ticket/doc plaintext on the relay socket', async () => {
    const serveStore = emptyStore()
    const source = addSharedProject(serveStore, {
      id: 'proj_p1',
      key: 'PROJ-1',
      sharedKey: 'AA',
      tickets: [
        makeTicket({
          id: 'tick_p1',
          key: 'AA-1',
          title: 'Persist the cart',
          description: TICKET_SECRET,
          branch: WORK_BRANCH,
        }),
      ],
      docs: [
        {
          id: 'doc_p1',
          key: 'DOC-1',
          title: DOC_SECRET,
          documentKey: '',
          projectId: 'proj_p1',
          labels: [],
          status: 'draft',
          origin: 'creator',
          owner: 'creator',
          createdAt: ts(),
          updatedAt: ts(),
        },
      ],
    })
    const pullStore = emptyStore()
    const importer = addImportedProject(pullStore, source, { id: 'proj_p1_imp', key: 'PROJ-9' })

    // Record every frame that crosses the relay's WebSocket in either
    // direction by wrapping the process-global WebSocket both channel managers
    // construct. This is now the WHOLE conversation — since sync moved off
    // WebRTC there is no second, private channel the board could be travelling
    // on instead. Everything the relay handles is captured here, and every
    // byte of it must be opaque.
    const RealWebSocket = globalThis.WebSocket
    const relayFrames: string[] = []
    class RecordingWebSocket extends RealWebSocket {
      constructor(...args: ConstructorParameters<typeof RealWebSocket>) {
        super(...args)
        this.addEventListener('message', (event: MessageEvent) => relayFrames.push(String(event.data)))
      }
      send(data: Parameters<WebSocket['send']>[0]) {
        relayFrames.push(String(data))
        return super.send(data)
      }
    }
    globalThis.WebSocket = RecordingWebSocket as unknown as typeof WebSocket

    try {
      const { applied } = startPair(serveStore, pullStore)
      const attempt = puller!.start(importer.project.id)
      await waitFor(() => server!.pending(), (p) => p.length === 1, { label: 'pending' })
      await server!.approve(attempt.id)
      const done = await waitFor(() => puller!.get(attempt.id), (a) => terminal(a.state), { label: 'applied' })
      expect(done.state).toBe('applied')
      expect(applied).toHaveLength(1) // the sync genuinely carried the board
    } finally {
      globalThis.WebSocket = RealWebSocket
    }

    const wire = relayFrames.join('\n')
    // We really captured the conversation (so the absences below mean
    // something): the snapshot itself crossed this socket, in frames big
    // enough to have carried the board.
    expect(relayFrames.length).toBeGreaterThan(0)
    expect(wire.length).toBeGreaterThan(1_000)
    // Every frame's payload is a sealed blob — no wire-protocol keyword
    // survives on the socket, not even the harmless ones.
    for (const marker of ['pull-request', 'snapshot-chunk', 'pull-received', '"kind"']) {
      expect(wire).not.toContain(marker)
    }
    // …and not a byte of project data crossed it.
    for (const secret of [TICKET_SECRET, DOC_SECRET, REPO_PATH, INTEGRATION_BRANCH, WORK_BRANCH, 'Persist the cart']) {
      expect(wire).not.toContain(secret)
    }
  })
})

// ── AC 5: repo and integrationBranch are absent from every captured payload ──
describe('machine-local fields never cross the wire', () => {
  it('the captured snapshot carries the board but none of the serving machine\'s local fields', async () => {
    const serveStore = emptyStore()
    const source = addSharedProject(serveStore, {
      id: 'proj_p1',
      key: 'PROJ-1',
      sharedKey: 'AA',
      tickets: [
        makeTicket({ id: 'tick_a', key: 'AA-1', title: 'Persist the cart', description: TICKET_SECRET, branch: WORK_BRANCH }),
        makeTicket({ id: 'tick_b', key: 'AA-2', title: 'Wire totals', branch: 'tick/another-local-branch' }),
      ],
    })
    const pullStore = emptyStore()
    const importer = addImportedProject(pullStore, source, { id: 'proj_p1_imp', key: 'PROJ-9' })

    const { applied } = startPair(serveStore, pullStore)
    const attempt = puller!.start(importer.project.id)
    await waitFor(() => server!.pending(), (p) => p.length === 1, { label: 'pending' })
    await server!.approve(attempt.id)
    const done = await waitFor(() => puller!.get(attempt.id), (a) => terminal(a.state), { label: 'applied' })
    expect(done.state).toBe('applied')

    const snapshot = applied[0]!.snapshot
    // The payload really carried the board (so absence below is meaningful).
    expect(snapshot.tickets.map((t) => t.title).sort()).toEqual(['Persist the cart', 'Wire totals'])
    expect(JSON.stringify(snapshot)).toContain(TICKET_SECRET)

    // …but not one machine-local field. The exporter's repo, integration
    // branch, per-ticket work branches, and its local project id are all gone.
    const asText = JSON.stringify(snapshot)
    expect(asText).not.toContain(REPO_PATH)
    expect(asText).not.toContain(INTEGRATION_BRANCH)
    expect(asText).not.toContain(WORK_BRANCH)
    expect(asText).not.toContain('proj_p1') // the serving machine's local project id
    for (const t of snapshot.tickets) {
      expect(t.branch).toBe('')
      expect(t.projectId).toBeNull()
    }
    // projectMeta is only the shareable trio — no repo/branch keys leaked in.
    expect(Object.keys(snapshot.projectMeta ?? {}).sort()).toEqual(['description', 'mode', 'title'])
  })

  it('the reverse direction strips the importer\'s local fields too', async () => {
    // Symmetry: pulls run both ways (TICK-295), so the importer's own machine
    // -local fields must never cross when the creator pulls from it either.
    const creatorStore = emptyStore()
    const source = addSharedProject(creatorStore, { id: 'proj_c', key: 'PROJ-1', sharedKey: 'AA' })
    const importerStore = emptyStore()
    const importer = addImportedProject(importerStore, source, { id: 'proj_i', key: 'PROJ-9' })
    const IMPORTER_BRANCH = 'tick/importer-secret-branch'
    importerStore.tickets.push(
      makeTicket({
        id: 'tick_imp',
        key: 'AA-2', // importer parity
        title: 'importer owned work',
        description: 'importer side detail',
        branch: IMPORTER_BRANCH,
        origin: 'importer',
        owner: 'importer',
        projectId: importer.project.id,
      }),
    )

    // The importer serves; the creator pulls the reverse room.
    const { applied } = startPair(importerStore, creatorStore)
    const attempt = puller!.start(source.project.id)
    await waitFor(() => server!.pending(), (p) => p.length === 1, { label: 'pending (reverse)' })
    await server!.approve(attempt.id)
    const done = await waitFor(() => puller!.get(attempt.id), (a) => terminal(a.state), { label: 'reverse applied' })
    expect(done.state).toBe('applied')

    const snapshot = applied[0]!.snapshot
    expect(snapshot.side).toBe('importer')
    expect(snapshot.projectMeta).toBeNull() // only the creator owns project metadata
    expect(snapshot.tickets.map((t) => t.title)).toEqual(['importer owned work']) // real payload
    const asText = JSON.stringify(snapshot)
    expect(asText).not.toContain(IMPORTER_BRANCH)
    expect(asText).not.toContain('/home/importer/somewhere-else') // the importer's repo
    expect(asText).not.toContain('proj_i') // the importer's local project id
    expect(snapshot.tickets[0]!.branch).toBe('')
    expect(snapshot.tickets[0]!.projectId).toBeNull()
  })
})

// ── AC 4 / invariant (b): approval is per-pull and cannot be replayed ─────────
describe('per-pull approval', () => {
  it('a consumed approval cannot be replayed to serve a second snapshot', async () => {
    const serveStore = emptyStore()
    const source = addSharedProject(serveStore, {
      id: 'proj_p1',
      key: 'PROJ-1',
      sharedKey: 'AA',
      tickets: [makeTicket({ id: 'tick_a', key: 'AA-1', title: 'Persist the cart' })],
    })
    const pullStore = emptyStore()
    const importer = addImportedProject(pullStore, source, { id: 'proj_p1_imp', key: 'PROJ-9' })

    startPair(serveStore, pullStore)
    const attempt = puller!.start(importer.project.id)
    await waitFor(() => server!.pending(), (p) => p.length === 1, { label: 'pending' })
    await server!.approve(attempt.id)
    await waitFor(() => puller!.get(attempt.id), (a) => terminal(a.state), { label: 'applied' })

    // The request is consumed — approving it again refuses; a fresh pull would
    // need its own human approval.
    await expect(server!.approve(attempt.id)).rejects.toThrow(/unknown pull request/i)
    expect(server!.pending()).toHaveLength(0)
  })
})
