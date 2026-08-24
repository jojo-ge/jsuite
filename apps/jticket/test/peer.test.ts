import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { startLocalRelay, type LocalRelay } from '@jsuite/relay'
import { createPeerManager, type PeerManager, type PeerStatus } from '../server/utils/peer'
import { createRoom, openSocket, waitFor } from './helpers'

// Two peer managers in one process, one local relay between them — the
// in-process half of TICK-289. The two-instance harness covers the same flow
// across real server processes.

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
  return waitFor(() => manager.get(id), predicate, options)
}

async function connectPair() {
  const { roomId, secret } = await createRoom(relay)
  a = createPeerManager()
  b = createPeerManager()
  const relayUrl = relay.url.href
  const { id: idB } = b.dial({ relayUrl, roomId, secret, initiator: false, echo: true })
  const { id: idA } = a.dial({ relayUrl, roomId, secret, initiator: true })
  await waitForPeer(a, idA, (s) => s.state === 'connected', { label: 'A connected' })
  await waitForPeer(b, idB, (s) => s.state === 'connected', { label: 'B connected' })
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
    a.close(first.idA)
    b.close(first.idB)

    // Same room, same secret — a brand-new handshake through the relay.
    const relayUrl = relay.url.href
    const { roomId, secret } = first
    const { id: idB2 } = b.dial({ relayUrl, roomId, secret, initiator: false, echo: true })
    const { id: idA2 } = a.dial({ relayUrl, roomId, secret, initiator: true })
    await waitForPeer(a, idA2, (s) => s.state === 'connected', { label: 'A reconnected' })
    await waitForPeer(b, idB2, (s) => s.state === 'connected', { label: 'B reconnected' })

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
      const { id } = a.dial({ relayUrl: relay.url.href, roomId, secret, initiator: true })
      const status = await waitForPeer(a, id, (s) => s.state === 'failed', { label: 'refusal' })
      expect(status.reason).toContain('room full')
    } finally {
      first.close()
      second.close()
    }
  })
})
