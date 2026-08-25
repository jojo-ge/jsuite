import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startLocalRelay } from '../index.mjs'

// The local relay stands in for Supabase Realtime Broadcast in jTicket's
// tests, so what matters is that it matches those semantics: frames reach the
// topic's other members, never the sender, and never a different topic. If it
// drifts from that, every suite built on it is testing a fiction.

let relay

beforeAll(async () => {
  relay = await startLocalRelay()
})

afterAll(async () => {
  await relay?.dispose()
})

/** A socket joined to one topic, collecting whatever arrives. */
async function member(topic) {
  const ws = new WebSocket(relay.url)
  const received = []
  ws.addEventListener('message', (event) => received.push(JSON.parse(String(event.data))))
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', () => reject(new Error('socket failed to open')), { once: true })
  })
  ws.send(JSON.stringify({ t: 'join', topic }))
  return {
    received,
    send: (sealed) => ws.send(JSON.stringify({ t: 'frame', topic, sealed })),
    close: () => ws.close(),
  }
}

const settle = (ms = 200) => new Promise((resolve) => setTimeout(resolve, ms))

describe('local relay', () => {
  it('fans a frame out to the topic\'s other members', async () => {
    const [a, b, c] = await Promise.all([member('room-1'), member('room-1'), member('room-1')])
    try {
      a.send('sealed-payload')
      await settle()
      expect(b.received).toEqual([{ t: 'frame', topic: 'room-1', sealed: 'sealed-payload' }])
      expect(c.received).toEqual([{ t: 'frame', topic: 'room-1', sealed: 'sealed-payload' }])
      // Like a Supabase broadcast with self:false — the pull protocol depends
      // on it, since both sides sit on one topic.
      expect(a.received).toEqual([])
    } finally {
      for (const m of [a, b, c]) m.close()
    }
  })

  it('keeps topics apart', async () => {
    const [a, b] = await Promise.all([member('room-a'), member('room-b')])
    try {
      a.send('for-a')
      await settle()
      expect(b.received).toEqual([])
    } finally {
      a.close()
      b.close()
    }
  })

  it('stops delivering to a member that has left', async () => {
    const [a, b] = await Promise.all([member('room-2'), member('room-2')])
    try {
      b.close()
      await settle()
      a.send('after-departure')
      await settle()
      expect(b.received).toEqual([])
    } finally {
      a.close()
    }
  })

  it('ignores malformed traffic instead of dropping the connection', async () => {
    const [a, b] = await Promise.all([member('room-3'), member('room-3')])
    try {
      const ws = new WebSocket(relay.url)
      await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }))
      ws.send('not json at all {{{')
      ws.send(JSON.stringify({ t: 'frame' })) // no topic
      ws.send(JSON.stringify({ t: 'mystery', topic: 'room-3' }))
      await settle()
      ws.close()

      // The room still works.
      a.send('still-here')
      await settle()
      expect(b.received).toEqual([{ t: 'frame', topic: 'room-3', sealed: 'still-here' }])
    } finally {
      a.close()
      b.close()
    }
  })

  it('refuses a plain HTTP request with 426', async () => {
    const res = await fetch(relay.url.replace('ws://', 'http://'))
    expect(res.status).toBe(426)
  })
})
