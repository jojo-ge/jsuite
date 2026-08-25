import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { startLocalRelay } from '../index.mjs'
import { createRoom, join, joinUrl, closed, nextMessage, expectSilence, sleep } from './helpers.mjs'

let relay

beforeAll(async () => {
  relay = await startLocalRelay()
})

afterAll(async () => {
  await relay?.dispose()
})

describe('room creation and blob ferrying', () => {
  it('creates a room with an id, a secret and an expiry', async () => {
    const res = await createRoom(relay)
    expect(res.status).toBe(201)
    const room = await res.json()
    expect(room.roomId).toMatch(/\S/)
    expect(room.secret).toMatch(/\S/)
    expect(room.expiresAt).toBeGreaterThan(Date.now())
  })

  it('ferries opaque blobs both ways between two joined members', async () => {
    const { roomId, secret } = await (await createRoom(relay)).json()
    const a = await join(relay, roomId, secret)
    const b = await join(relay, roomId, secret)

    a.send('offer-blob from A')
    expect(await nextMessage(b)).toBe('offer-blob from A')

    b.send('answer-blob from B')
    expect(await nextMessage(a)).toBe('answer-blob from B')

    a.close()
    b.close()
    await Promise.all([closed(a), closed(b)])
  })
})

describe('admission control', () => {
  it('rejects a wrong room secret with close code 4002', async () => {
    const { roomId } = await (await createRoom(relay)).json()
    const intruder = new WebSocket(joinUrl(relay, roomId, 'not-the-secret'))
    const { code } = await closed(intruder)
    expect(code).toBe(4002)
  })

  it('rejects an unknown room with close code 4001', async () => {
    const ws = new WebSocket(joinUrl(relay, 'no-such-room', 'whatever'))
    const { code } = await closed(ws)
    expect(code).toBe(4001)
  })

  it('refuses a third concurrent member with close code 4003', async () => {
    const { roomId, secret } = await (await createRoom(relay)).json()
    const a = await join(relay, roomId, secret)
    const b = await join(relay, roomId, secret)

    const third = new WebSocket(joinUrl(relay, roomId, secret))
    const { code } = await closed(third)
    expect(code).toBe(4003)

    // the refused socket must not have bumped either member
    a.send('still ferrying')
    expect(await nextMessage(b)).toBe('still ferrying')

    a.close()
    b.close()
    await Promise.all([closed(a), closed(b)])
  })

  it('frees the slot when a member disconnects, so a fresh handshake can re-dial', async () => {
    const { roomId, secret } = await (await createRoom(relay)).json()
    const a = await join(relay, roomId, secret)
    const b = await join(relay, roomId, secret)
    b.close()
    await closed(b)

    const b2 = await join(relay, roomId, secret)
    a.send('offer again')
    expect(await nextMessage(b2)).toBe('offer again')

    a.close()
    b2.close()
    await Promise.all([closed(a), closed(b2)])
  })
})

describe('expiry', () => {
  const TWO_HOURS_MS = 2 * 60 * 60 * 1000

  it('honours a shorter ttlMs but clamps it to the 2h maximum', async () => {
    const before = Date.now()
    const short = await (await createRoom(relay, { ttlMs: 100 })).json()
    expect(short.expiresAt).toBeLessThanOrEqual(before + 100 + 5000)

    const huge = await (await createRoom(relay, { ttlMs: TWO_HOURS_MS * 10 })).json()
    expect(huge.expiresAt).toBeLessThanOrEqual(Date.now() + TWO_HOURS_MS)
  })

  it('refuses new joins to an expired room with close code 4004', async () => {
    const { roomId, secret } = await (await createRoom(relay, { ttlMs: 100 })).json()
    await sleep(150)
    const ws = new WebSocket(joinUrl(relay, roomId, secret))
    const { code } = await closed(ws)
    expect(code).toBe(4004)
  })

  it('lets members already connected keep ferrying past expiry (in-flight pulls complete)', async () => {
    const { roomId, secret } = await (await createRoom(relay, { ttlMs: 200 })).json()
    const a = await join(relay, roomId, secret)
    const b = await join(relay, roomId, secret)
    await sleep(250)

    a.send('mid-pull blob')
    expect(await nextMessage(b)).toBe('mid-pull blob')

    a.close()
    b.close()
    await Promise.all([closed(a), closed(b)])
  })
})

describe('kill switch', () => {
  function killRoom(roomId, secret) {
    const url = new URL(`/rooms/${roomId}`, relay.url)
    if (secret !== undefined) url.searchParams.set('secret', secret)
    return fetch(url, { method: 'DELETE' })
  }

  it('disconnects both members with close code 4005 and refuses everyone afterwards', async () => {
    const { roomId, secret } = await (await createRoom(relay)).json()
    const a = await join(relay, roomId, secret)
    const b = await join(relay, roomId, secret)

    const res = await killRoom(roomId, secret)
    expect(res.status).toBe(204)

    const [aClose, bClose] = await Promise.all([closed(a), closed(b)])
    expect(aClose.code).toBe(4005)
    expect(bClose.code).toBe(4005)

    const again = new WebSocket(joinUrl(relay, roomId, secret))
    expect((await closed(again)).code).toBe(4005)
  })

  it('requires the room secret to kill', async () => {
    const { roomId, secret } = await (await createRoom(relay)).json()
    expect((await killRoom(roomId, 'wrong')).status).toBe(403)
    expect((await killRoom(roomId)).status).toBe(403)

    // room still admits with the real secret
    const ws = await join(relay, roomId, secret)
    ws.close()
    await closed(ws)
  })
})

describe('in-flight-only ferrying — nothing persists beyond the hand-off', () => {
  it('holds a blob sent while the peer is absent and delivers it when the peer joins', async () => {
    const { roomId, secret } = await (await createRoom(relay)).json()
    const a = await join(relay, roomId, secret)
    a.send('early offer')

    const b = await join(relay, roomId, secret)
    expect(await nextMessage(b)).toBe('early offer')

    a.close()
    b.close()
    await Promise.all([closed(a), closed(b)])
  })

  it('drops undelivered blobs when their sender disconnects', async () => {
    const { roomId, secret } = await (await createRoom(relay)).json()
    const a = await join(relay, roomId, secret)
    a.send('orphaned offer')
    a.close()
    await closed(a)

    const b = await join(relay, roomId, secret)
    await expectSilence(b)
    b.close()
    await closed(b)
  })

  it('never replays a delivered blob to members who reconnect', async () => {
    const { roomId, secret } = await (await createRoom(relay)).json()
    const a = await join(relay, roomId, secret)
    const b = await join(relay, roomId, secret)
    a.send('one-shot blob')
    expect(await nextMessage(b)).toBe('one-shot blob')
    a.close()
    b.close()
    await Promise.all([closed(a), closed(b)])

    const a2 = await join(relay, roomId, secret)
    const b2 = await join(relay, roomId, secret)
    await Promise.all([expectSilence(a2), expectSilence(b2)])
    a2.close()
    b2.close()
    await Promise.all([closed(a2), closed(b2)])
  })
})

describe('client-supplied rooms — jTicket shares mint room ids locally', () => {
  function killRoom(roomId, secret) {
    const url = new URL(`/rooms/${roomId}`, relay.url)
    url.searchParams.set('secret', secret)
    return fetch(url, { method: 'DELETE' })
  }

  it('registers a room under the supplied id and secret', async () => {
    const res = await createRoom(relay, { roomId: 'share-room-1', secret: 'share-secret', ttlMs: 60_000 })
    expect(res.status).toBe(201)
    const room = await res.json()
    expect(room.roomId).toBe('share-room-1')
    expect(room.secret).toBe('share-secret')

    // …and it admits members exactly like a minted room.
    const a = await join(relay, 'share-room-1', 'share-secret')
    const b = await join(relay, 'share-room-1', 'share-secret')
    a.send('blob')
    expect(await nextMessage(b)).toBe('blob')
    a.close()
    b.close()
    await Promise.all([closed(a), closed(b)])
  })

  it('re-registering with the matching secret refreshes the expiry', async () => {
    await createRoom(relay, { roomId: 'refresh-room', secret: 's3', ttlMs: 100 })
    await sleep(150)
    const res = await createRoom(relay, { roomId: 'refresh-room', secret: 's3', ttlMs: 60_000 })
    expect(res.status).toBe(201)
    expect((await res.json()).roomId).toBe('refresh-room')
    const a = await join(relay, 'refresh-room', 's3')
    const b = await join(relay, 'refresh-room', 's3')
    a.send('post-refresh blob')
    expect(await nextMessage(b)).toBe('post-refresh blob')
    a.close()
    b.close()
    await Promise.all([closed(a), closed(b)])
  })

  it('refuses to re-register with a different secret', async () => {
    await createRoom(relay, { roomId: 'squat-room', secret: 'right', ttlMs: 60_000 })
    const res = await createRoom(relay, { roomId: 'squat-room', secret: 'wrong', ttlMs: 60_000 })
    expect(res.status).toBe(403)
  })

  it('a killed room stays dead — re-registration cannot revive it', async () => {
    await createRoom(relay, { roomId: 'dead-room', secret: 'sd', ttlMs: 60_000 })
    expect((await killRoom('dead-room', 'sd')).status).toBe(204)
    const res = await createRoom(relay, { roomId: 'dead-room', secret: 'sd', ttlMs: 60_000 })
    expect(res.status).toBe(409)
    const ws = new WebSocket(joinUrl(relay, 'dead-room', 'sd'))
    expect((await closed(ws)).code).toBe(4005)
  })
})
