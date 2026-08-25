import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { startLocalRelay, type LocalRelay } from '@jsuite/relay'
import { createChannelManager, roomTopic, type ChannelManager } from '../server/utils/syncChannel'
import { createLocalTransport } from '../server/utils/syncTransport'
import { roomKey, sealFrame } from '../server/utils/syncCrypto'
import type { PullWireMessage } from '../server/utils/syncWire'
import { newRoom, sleep, waitFor } from './helpers'

// The channel manager — jTicket's end of a sync connection, and the successor
// to the WebRTC peer manager (TICK-3xx). What it owes its callers: typed wire
// messages in and out of a named room, sealed on the way through, and an
// honest state when the relay is unreachable.

let relay: LocalRelay
const managers: ChannelManager[] = []

function manager(): ChannelManager {
  const m = createChannelManager({ kind: 'local', url: relay.url })
  managers.push(m)
  return m
}

beforeAll(async () => {
  relay = await startLocalRelay()
})

afterEach(() => {
  for (const m of managers.splice(0)) m.closeAll()
})

afterAll(async () => {
  await relay.dispose()
})

const request = (requestId: string): PullWireMessage =>
  ({ v: 1, kind: 'pull-request', requestId, projectUuid: 'uuid' })

/** Join both ends of a room and wait until each is live. */
async function joinPair(roomId: string, secretA: string, secretB: string) {
  const [a, b] = [manager(), manager()]
  const seenByB: PullWireMessage[] = []
  const seenByA: PullWireMessage[] = []
  const idA = a.join({ roomId, roomSecret: secretA, onMessage: (m) => seenByA.push(m) }).id
  const idB = b.join({ roomId, roomSecret: secretB, onMessage: (m) => seenByB.push(m) }).id
  await waitFor(
    () => (a.get(idA)?.state === 'joined' && b.get(idB)?.state === 'joined' ? true : undefined),
    (v) => v,
    { label: 'both channels joined' },
  )
  return { a, b, idA, idB, seenByA, seenByB }
}

describe('channel manager', () => {
  it('carries typed wire messages between two members of a room', async () => {
    const room = newRoom()
    const { a, idA, seenByB } = await joinPair(room.roomId, room.secret, room.secret)

    await a.send(idA, request('r1'))

    await waitFor(() => (seenByB.length ? seenByB : undefined), (m) => m.length === 1, { label: 'delivery' })
    expect(seenByB[0]).toEqual(request('r1'))
  })

  it('never echoes a sender its own frame — both sides share one topic', async () => {
    const room = newRoom()
    const { a, idA, seenByA, seenByB } = await joinPair(room.roomId, room.secret, room.secret)

    await a.send(idA, request('r2'))
    await waitFor(() => (seenByB.length ? seenByB : undefined), (m) => m.length === 1, { label: 'delivery' })
    expect(seenByA).toEqual([])
  })

  it('drops frames sealed for a different room', async () => {
    const room = newRoom()
    const other = newRoom()
    // Same topic, wrong key: the relay delivers, the channel cannot open it.
    const { seenByB } = await joinPair(room.roomId, other.secret, room.secret)

    const transport = createLocalTransport(relay.url)
    const topic = transport.join(roomTopic(room.roomId), {
      onJoined: () => {},
      onError: () => {},
      onFrame: () => {},
    })
    try {
      await topic.send(sealFrame(roomKey(other.secret), JSON.stringify(request('r3'))))
      await sleep(500)
      expect(seenByB).toEqual([])
    } finally {
      topic.leave()
      transport.dispose()
    }
  })

  it('drops readable frames that are not valid wire messages', async () => {
    const room = newRoom()
    const { seenByB } = await joinPair(room.roomId, room.secret, room.secret)

    const key = roomKey(room.secret)
    const transport = createLocalTransport(relay.url)
    const topic = transport.join(roomTopic(room.roomId), {
      onJoined: () => {},
      onError: () => {},
      onFrame: () => {},
    })
    try {
      await topic.send(sealFrame(key, 'not json at all {{{'))
      await topic.send(sealFrame(key, JSON.stringify({ v: 99, kind: 'pull-request' })))
      await topic.send(sealFrame(key, JSON.stringify({ v: 1, kind: 'nonsense' })))
      await sleep(500)
      expect(seenByB).toEqual([])
    } finally {
      topic.leave()
      transport.dispose()
    }
  })

  it('refuses to send on a channel that is not joined', async () => {
    const room = newRoom()
    const m = manager()
    const { id } = m.join({ roomId: room.roomId, roomSecret: room.secret })
    m.close(id)
    await expect(m.send(id, request('r4'))).rejects.toThrow(/not joined/)
  })

  it('reports a closed channel and fires onClose exactly once', async () => {
    const room = newRoom()
    const m = manager()
    let closes = 0
    const { id } = m.join({ roomId: room.roomId, roomSecret: room.secret, onClose: () => closes++ })
    m.close(id)
    m.close(id)
    expect(m.get(id)?.state).toBe('closed')
    expect(closes).toBe(1)
  })

  it('fails a channel whose relay never answers, with the reason on the status', async () => {
    // Port 1 is reliably nobody. A relay that cannot be reached must surface as
    // a failed channel, not a channel that waits forever.
    const m = createChannelManager({ kind: 'local', url: 'ws://127.0.0.1:1' })
    managers.push(m)
    const room = newRoom()
    const { id } = m.join({ roomId: room.roomId, roomSecret: room.secret })
    const status = await waitFor(() => m.get(id), (s) => s.state === 'failed', { label: 'failed channel' })
    expect(status.reason).toBeTruthy()
  })

  it('throws rather than keying a channel off an empty secret', () => {
    const m = manager()
    expect(() => m.join({ roomId: 'r', roomSecret: '' })).toThrow(/required/)
  })
})
