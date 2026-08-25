// Hardening for the public deployment (TICK-309): per-message size caps,
// per-IP rate limits on room creation and joins, and alarm-based GC of
// expired room metadata. Each suite spins its own relay so the tiny limits
// pinned here never bleed into the main suite's default-config relay.

import { describe, it, expect, afterAll } from 'vitest'
import { startLocalRelay } from '../index.mjs'
import { createRoom, join, joinUrl, closed, nextMessage, expectSilence, sleep } from './helpers.mjs'

const relays = []
async function relayWith(bindings) {
  const relay = await startLocalRelay({ bindings })
  relays.push(relay)
  return relay
}

afterAll(async () => {
  await Promise.all(relays.map((relay) => relay.dispose()))
})

describe('per-message size cap', () => {
  it('closes the sender with 4006 and never delivers the oversized frame', async () => {
    const relay = await relayWith({ RELAY_MAX_MESSAGE_BYTES: '1024' })
    const { roomId, secret } = await (await createRoom(relay)).json()
    const a = await join(relay, roomId, secret)
    const b = await join(relay, roomId, secret)

    a.send('x'.repeat(2048))
    const { code } = await closed(a)
    expect(code).toBe(4006)
    await expectSilence(b)

    // the freed slot admits a fresh member, and ferrying still works
    const a2 = await join(relay, roomId, secret)
    a2.send('small enough')
    expect(await nextMessage(b)).toBe('small enough')

    a2.close()
    b.close()
    await Promise.all([closed(a2), closed(b)])
  })

  it('a frame the size of a snapshot chunk clears the default cap', async () => {
    const relay = await relayWith({})
    const { roomId, secret } = await (await createRoom(relay)).json()
    const a = await join(relay, roomId, secret)
    const b = await join(relay, roomId, secret)

    // The shape jTicket's sync actually ferries at its largest: a 16k-char
    // snapshot chunk in its JSON envelope (syncWire.SNAPSHOT_CHUNK_CHARS) —
    // must stay comfortably under the default cap.
    const frame = JSON.stringify({
      v: 1,
      kind: 'snapshot-chunk',
      requestId: 'req_1',
      seq: 0,
      total: 1,
      data: 'x'.repeat(16_000),
    })
    a.send(frame)
    expect(await nextMessage(b)).toBe(frame)

    a.close()
    b.close()
    await Promise.all([closed(a), closed(b)])
  })
})

describe('rate limiting room creation', () => {
  it('refuses creates past the per-minute limit with 429, per IP', async () => {
    const relay = await relayWith({ RELAY_CREATES_PER_MINUTE: '3' })
    const ip = (address) => ({ 'CF-Connecting-IP': address })

    for (let i = 0; i < 3; i++) {
      expect((await createRoom(relay, undefined, ip('198.51.100.7'))).status).toBe(201)
    }
    expect((await createRoom(relay, undefined, ip('198.51.100.7'))).status).toBe(429)

    // a different caller is not punished for the flooder's traffic
    expect((await createRoom(relay, undefined, ip('203.0.113.9'))).status).toBe(201)
  })
})

describe('rate limiting joins', () => {
  it('refuses joins past the per-minute limit with close code 4007', async () => {
    const relay = await relayWith({ RELAY_JOINS_PER_MINUTE: '2' })
    const { roomId, secret } = await (await createRoom(relay)).json()

    const a = await join(relay, roomId, secret)
    const b = await join(relay, roomId, secret)

    const third = new WebSocket(joinUrl(relay, roomId, secret))
    const { code } = await closed(third)
    expect(code).toBe(4007)

    // the refusal is the limiter's, not the room's — members keep ferrying
    a.send('still ferrying')
    expect(await nextMessage(b)).toBe('still ferrying')

    a.close()
    b.close()
    await Promise.all([closed(a), closed(b)])
  })

  it('meters non-join room traffic under the same budget — probes cannot spin DOs for free', async () => {
    const relay = await relayWith({ RELAY_JOINS_PER_MINUTE: '2' })
    expect((await fetch(new URL('/rooms/no-such-room', relay.url), { method: 'DELETE' })).status).toBe(404)
    expect((await fetch(new URL('/rooms/another-room', relay.url), { method: 'DELETE' })).status).toBe(404)
    expect((await fetch(new URL('/rooms/a-third-room', relay.url), { method: 'DELETE' })).status).toBe(429)
  })
})

describe('alarm-based GC of expired rooms', () => {
  it('forgets an empty expired room — joins see 4001, and the id is free again', async () => {
    const relay = await relayWith({ RELAY_GC_GRACE_MS: '50' })
    const { roomId, secret } = await (await createRoom(relay, { ttlMs: 100 })).json()
    await sleep(600)

    const ws = new WebSocket(joinUrl(relay, roomId, secret))
    expect((await closed(ws)).code).toBe(4001)

    // metadata is gone, so the id can be registered fresh (a re-armed share)
    const res = await createRoom(relay, { roomId, secret: 'a-new-secret', ttlMs: 60_000 })
    expect(res.status).toBe(201)
  })

  it('leaves a room with connected members alone, then forgets it once they leave', async () => {
    const relay = await relayWith({ RELAY_GC_GRACE_MS: '50', RELAY_GC_RECHECK_MS: '100' })
    const { roomId, secret } = await (await createRoom(relay, { ttlMs: 100 })).json()
    const a = await join(relay, roomId, secret)
    const b = await join(relay, roomId, secret)
    await sleep(600)

    // the GC alarm has fired, members are connected — in-flight pulls complete
    a.send('mid-pull blob')
    expect(await nextMessage(b)).toBe('mid-pull blob')

    a.close()
    b.close()
    await Promise.all([closed(a), closed(b)])

    // …and the rescheduled alarm deletes the room once it has emptied
    await sleep(600)
    const ws = new WebSocket(joinUrl(relay, roomId, secret))
    expect((await closed(ws)).code).toBe(4001)
  })

  it('forgets killed rooms too — after expiry + grace the id is registrable again', async () => {
    const relay = await relayWith({ RELAY_GC_GRACE_MS: '50' })
    const { roomId, secret } = await (await createRoom(relay, { ttlMs: 100 })).json()
    const url = new URL(`/rooms/${roomId}`, relay.url)
    url.searchParams.set('secret', secret)
    expect((await fetch(url, { method: 'DELETE' })).status).toBe(204)
    await sleep(600)

    // within a share's lifetime killed-stays-dead holds (relay.test.mjs pins
    // the 409); once the room would have expired anyway, the id is free
    const res = await createRoom(relay, { roomId, secret: 'a-new-secret', ttlMs: 60_000 })
    expect(res.status).toBe(201)
  })
})
