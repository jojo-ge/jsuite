import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { startLocalRelay, type LocalRelay } from '@jsuite/relay'
import { createPeerManager, type PeerManager, type PeerStatus } from '../server/utils/peer'
import { createRoom, openSocket, waitFor } from './helpers'

// Two peer managers in one process, one local relay between them — the
// in-process half of TICK-289. The two-instance harness covers the same flow
// across real server processes.
//
// Messages are delivered to the dialer's onMessage callback (TICK-294): the
// received[] buffer and the echo option were harness affordances, replaced by
// real message handling once pull traffic existed.

// Everything here talks to itself, so keep ICE on loopback: on real interfaces
// (VPN subnets, rotating IPv6 privacy addresses) self-connections flake with
// EADDRNOTAVAIL mid-DTLS under suite-wide load (TICK-300).
const LOOPBACK = { bindAddress: '127.0.0.1' }

let relay: LocalRelay
let a: PeerManager
let b: PeerManager

beforeAll(async () => {
  relay = await startLocalRelay()
})

afterAll(async () => {
  await relay.dispose()
})

afterEach(() => {
  a?.closeAll()
  b?.closeAll()
})

function waitForPeer(
  manager: PeerManager,
  id: string,
  predicate: (status: PeerStatus) => boolean,
  options?: { label?: string },
) {
  return waitFor(
    () => manager.get(id),
    (status) => {
      if (predicate(status)) return true
      // 'failed' is terminal — polling on would only burn the whole timeout.
      if (status.state === 'failed') {
        throw new Error(`peer failed while waiting for ${options?.label ?? 'condition'}: ${status.reason}`)
      }
      return false
    },
    options,
  )
}

/**
 * The relay frees a member slot only once it has processed that socket's
 * close — joining before then races its bookkeeping (refused as room full, or
 * paired with the departing socket and the handshake blobs lost).
 * signalingClosed flips when the close handshake completes, by which point the
 * relay has already dropped the member in every observed ordering (the
 * connectInRoom retry covers a miss). No fail-fast here: the peer being waited
 * on is usually closed or failed already.
 */
function waitForSlotFreed(manager: PeerManager, id: string, label: string) {
  return waitFor(() => manager.get(id), (s) => s.signalingClosed, { label })
}

/** Tear a pair down and wait until the relay can accept a re-dial. */
async function closePairAndFreeSlots(idA: string, idB: string) {
  a.close(idA)
  b.close(idB)
  await waitForSlotFreed(a, idA, 'A slot freed')
  await waitForSlotFreed(b, idB, 'B slot freed')
}

interface SideCallbacks {
  onOpen?: () => void
  onMessage?: (data: string) => void
  onClose?: () => void
}

/**
 * Dial a and b into the room until both connect. Same-host handshakes can
 * abort mid-DTLS (libdatachannel treats the first UDP I/O hiccup as fatal), so
 * a failed pair is torn down and re-dialed rather than failing the test.
 *
 * Callbacks are buffered per attempt and delivered only once that attempt's
 * pair proves out — a failed attempt's opens and closes must not leak into the
 * test's counters. Every test that asserts on dial callbacks goes through
 * here: a lone direct dial was the residual flake (TICK-308).
 */
async function connectInRoom(
  roomId: string,
  secret: string,
  options?: { a?: SideCallbacks; b?: SideCallbacks },
  attempts = 5,
) {
  const relayUrl = relay.url.href
  let lastError: unknown
  for (let attempt = 0; attempt < attempts; attempt++) {
    let won = false
    const buffered: Array<() => void> = []
    const fire = (event: () => void) => (won ? event() : buffered.push(event))
    const gated = (side?: SideCallbacks): SideCallbacks => ({
      ...(side?.onOpen && { onOpen: () => fire(() => side.onOpen!()) }),
      ...(side?.onMessage && { onMessage: (d: string) => fire(() => side.onMessage!(d)) }),
      ...(side?.onClose && { onClose: () => fire(() => side.onClose!()) }),
    })
    const { id: idB } = b.dial({ ...LOOPBACK, relayUrl, roomId, secret, initiator: false, ...gated(options?.b) })
    const { id: idA } = a.dial({ ...LOOPBACK, relayUrl, roomId, secret, initiator: true, ...gated(options?.a) })
    try {
      await waitForPeer(a, idA, (s) => s.state === 'connected', { label: 'A connected' })
      await waitForPeer(b, idB, (s) => s.state === 'connected', { label: 'B connected' })
      won = true
      for (const event of buffered.splice(0)) event()
      return { idA, idB }
    } catch (error) {
      lastError = error
      await closePairAndFreeSlots(idA, idB)
    }
  }
  throw lastError
}

interface Pair {
  idA: string
  idB: string
  roomId: string
  secret: string
  atA: string[]
  atB: string[]
}

/** Connect a pair; each side collects incoming messages into an array. */
async function connectPair(): Promise<Pair> {
  const { roomId, secret } = await createRoom(relay)
  a = createPeerManager()
  b = createPeerManager()
  const atA: string[] = []
  const atB: string[] = []
  const { idA, idB } = await connectInRoom(roomId, secret, {
    a: { onMessage: (d) => atA.push(d) },
    b: { onMessage: (d) => atB.push(d) },
  })
  return { idA, idB, roomId, secret, atA, atB }
}

describe('peer manager', () => {
  it('connects two peers through the relay and delivers messages both ways, in order', async () => {
    const { idA, idB, atA, atB } = await connectPair()

    a.send(idA, 'one')
    a.send(idA, 'two')
    a.send(idA, 'three')
    await waitFor(() => atB, (m) => m.length === 3, { label: 'three messages at B' })
    expect(atB).toEqual(['one', 'two', 'three'])

    b.send(idB, 'reply')
    await waitFor(() => atA, (m) => m.length === 1, { label: 'reply at A' })
    expect(atA).toEqual(['reply'])
  })

  it('fires onOpen on both sides once the channel opens', async () => {
    const { roomId, secret } = await createRoom(relay)
    a = createPeerManager()
    b = createPeerManager()
    const opened: string[] = []
    await connectInRoom(roomId, secret, {
      a: { onOpen: () => opened.push('a') },
      b: { onOpen: () => opened.push('b') },
    })
    await waitFor(() => opened, (o) => o.length === 2, { label: 'both onOpen fired' })
    expect(opened.sort()).toEqual(['a', 'b'])
  })

  it('no longer exposes a received buffer on status', async () => {
    const { idA } = await connectPair()
    expect(a.get(idA)).not.toHaveProperty('received')
  })
})

describe('teardown and re-dial', () => {
  it('close() tears the connection down and the far side observes it via onClose', async () => {
    const { roomId, secret } = await createRoom(relay)
    a = createPeerManager()
    b = createPeerManager()
    let bClosed = 0
    const { idA, idB } = await connectInRoom(roomId, secret, { b: { onClose: () => bClosed++ } })

    a.close(idA)
    expect(a.get(idA)?.state).toBe('closed')
    expect(() => a.send(idA, 'after close')).toThrow()
    await waitForPeer(b, idB, (s) => s.state === 'closed', { label: 'B sees the close' })
    await waitFor(() => bClosed, (n) => n === 1, { label: 'B onClose fired once' })
  })

  it('re-dials the same room with a fresh handshake after teardown', async () => {
    const first = await connectPair()
    await closePairAndFreeSlots(first.idA, first.idB)

    // Same room, same secret — a brand-new handshake through the relay.
    const atB2: string[] = []
    const { idA: idA2 } = await connectInRoom(first.roomId, first.secret, {
      b: { onMessage: (d) => atB2.push(d) },
    })

    a.send(idA2, 'again')
    await waitFor(() => atB2, (m) => m.length === 1, { label: 'message after re-dial' })
    expect(atB2).toEqual(['again'])
  })
})

describe('relay refusals', () => {
  it('fails with the relay reason when the secret is wrong, and onClose fires', async () => {
    const { roomId } = await createRoom(relay)
    a = createPeerManager()
    let closes = 0
    const { id } = a.dial({
      ...LOOPBACK,
      relayUrl: relay.url.href,
      roomId,
      secret: 'not-the-secret',
      initiator: true,
      onClose: () => closes++,
    })
    const status = await waitForPeer(a, id, (s) => s.state === 'failed', { label: 'refusal' })
    expect(status.reason).toContain('wrong secret')
    await waitFor(() => closes, (n) => n === 1, { label: 'onClose fired on failure' })
  })

  it('fails with the relay reason for an unknown room', async () => {
    a = createPeerManager()
    const { id } = a.dial({
      ...LOOPBACK,
      relayUrl: relay.url.href,
      roomId: 'no-such-room',
      secret: 'whatever',
      initiator: true,
    })
    const status = await waitForPeer(a, id, (s) => s.state === 'failed', { label: 'refusal' })
    expect(status.reason).toContain('unknown room')
  })

  it('fails with the relay reason when the room is full', async () => {
    const { roomId, secret } = await createRoom(relay)
    // Occupy both member slots with raw sockets, then try to dial in.
    const first = await openSocket(relay, roomId, secret)
    const second = await openSocket(relay, roomId, secret)
    try {
      a = createPeerManager()
      const { id } = a.dial({ ...LOOPBACK, relayUrl: relay.url.href, roomId, secret, initiator: true })
      const status = await waitForPeer(a, id, (s) => s.state === 'failed', { label: 'refusal' })
      expect(status.reason).toContain('room full')
    } finally {
      first.close()
      second.close()
    }
  })
})
