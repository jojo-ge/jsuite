import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { startLocalRelay, type LocalRelay } from '@jsuite/relay'
import { createPeerManager, type PeerManager, type PeerStatus } from '../server/utils/peer'
import { createRoom, openSocket, waitFor } from './helpers'

// Two peer managers in one process, one local relay between them — the
// in-process half of TICK-289. The two-instance harness covers the same flow
// across real server processes.

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

/**
 * Dial a and b into the room until both connect. Same-host handshakes can
 * abort mid-DTLS (libdatachannel treats the first UDP I/O hiccup as fatal), so
 * a failed pair is torn down and re-dialed rather than failing the test.
 */
async function connectInRoom(roomId: string, secret: string, attempts = 5) {
  const relayUrl = relay.url.href
  let lastError: unknown
  for (let attempt = 0; attempt < attempts; attempt++) {
    const { id: idB } = b.dial({ ...LOOPBACK, relayUrl, roomId, secret, initiator: false, echo: true })
    const { id: idA } = a.dial({ ...LOOPBACK, relayUrl, roomId, secret, initiator: true })
    try {
      await waitForPeer(a, idA, (s) => s.state === 'connected', { label: 'A connected' })
      await waitForPeer(b, idB, (s) => s.state === 'connected', { label: 'B connected' })
      return { idA, idB }
    } catch (error) {
      lastError = error
      await closePairAndFreeSlots(idA, idB)
    }
  }
  throw lastError
}

async function connectPair() {
  const { roomId, secret } = await createRoom(relay)
  a = createPeerManager()
  b = createPeerManager()
  const { idA, idB } = await connectInRoom(roomId, secret)
  return { idA, idB, roomId, secret }
}

describe('peer manager', () => {
  it('connects two peers through the relay and round-trips bytes', async () => {
    const { idA, idB } = await connectPair()

    a.send(idA, 'ping-from-a')
    const echoed = await waitForPeer(a, idA, (s) => s.received.length > 0, { label: 'echo back at A' })
    expect(echoed.received).toEqual(['ping-from-a'])

    const atB = b.get(idB)
    expect(atB?.received).toEqual(['ping-from-a'])
  })

  it('delivers multiple messages in order', async () => {
    const { idA } = await connectPair()

    a.send(idA, 'one')
    a.send(idA, 'two')
    a.send(idA, 'three')
    const status = await waitForPeer(a, idA, (s) => s.received.length === 3, { label: 'three echoes at A' })
    expect(status.received).toEqual(['one', 'two', 'three'])
  })
})

describe('teardown and re-dial', () => {
  it('close() tears the connection down and the far side observes it', async () => {
    const { idA, idB } = await connectPair()

    a.close(idA)
    expect(a.get(idA)?.state).toBe('closed')
    expect(() => a.send(idA, 'after close')).toThrow()
    await waitForPeer(b, idB, (s) => s.state === 'closed', { label: 'B sees the close' })
  })

  it('re-dials the same room with a fresh handshake after teardown', async () => {
    const first = await connectPair()
    await closePairAndFreeSlots(first.idA, first.idB)

    // Same room, same secret — a brand-new handshake through the relay.
    const { idA: idA2 } = await connectInRoom(first.roomId, first.secret)

    a.send(idA2, 'again')
    const status = await waitForPeer(a, idA2, (s) => s.received.length > 0, { label: 'echo after re-dial' })
    expect(status.received).toEqual(['again'])
  })
})

describe('relay refusals', () => {
  it('fails with the relay reason when the secret is wrong', async () => {
    const { roomId } = await createRoom(relay)
    a = createPeerManager()
    const { id } = a.dial({
      ...LOOPBACK,
      relayUrl: relay.url.href,
      roomId,
      secret: 'not-the-secret',
      initiator: true,
    })
    const status = await waitForPeer(a, id, (s) => s.state === 'failed', { label: 'refusal' })
    expect(status.reason).toContain('wrong secret')
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
