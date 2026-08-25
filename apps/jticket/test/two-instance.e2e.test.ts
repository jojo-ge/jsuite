import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startLocalRelay, type LocalRelay } from '@jsuite/relay'
import { newRoom, waitFor } from './helpers'
import { startInstance, type Instance } from './harness/instance'

// The two-instance harness — TICK-289's end-to-end slice, rebuilt for the
// broadcast transport. Two real jTicket server processes and a local relay in
// one run: A and B join the same room and a frame really crosses between them,
// driven entirely through each instance's local HTTP API. No browser anywhere.
// The pull flow's own traffic is sync-pull.e2e.test.ts's job; this proves the
// pipe underneath it, including the part the relay can't see.

let relay: LocalRelay
let A: Instance
let B: Instance

beforeAll(async () => {
  relay = await startLocalRelay()
  ;[A, B] = await Promise.all([
    startInstance({ label: 'a', env: { JTICKET_SYNC_RELAY_URL: relay.url } }),
    startInstance({ label: 'b', env: { JTICKET_SYNC_RELAY_URL: relay.url } }),
  ])
})

afterAll(async () => {
  await Promise.all([A?.dispose(), B?.dispose()])
  await relay?.dispose()
})

async function api(instance: Instance, method: string, path: string, body?: unknown) {
  const res = await fetch(`${instance.url}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${await res.text()}`)
  return res.json()
}

const join = (instance: Instance, roomId: string, secret: string) =>
  api(instance, 'POST', '/api/sync/channel', { roomId, secret })

const status = (instance: Instance, id: string) => api(instance, 'GET', `/api/sync/channel/${id}`)

/** Both sides joined and settled — a send now has somebody to reach. */
async function joinPair(roomId: string, secretA: string, secretB: string) {
  const [{ id: idA }, { id: idB }] = await Promise.all([join(A, roomId, secretA), join(B, roomId, secretB)])
  await Promise.all([
    waitFor(() => status(A, idA), (s) => s.state === 'joined', { intervalMs: 100, label: 'A joined' }),
    waitFor(() => status(B, idB), (s) => s.state === 'joined', { intervalMs: 100, label: 'B joined' }),
  ])
  return { idA, idB }
}

const request = (requestId: string) =>
  ({ v: 1, kind: 'pull-request', requestId, projectUuid: 'uuid-under-test' })

describe('two jTicket instances over the local relay', () => {
  it('carries a wire message from A to B', async () => {
    const room = newRoom()
    const { idA, idB } = await joinPair(room.roomId, room.secret, room.secret)

    await api(A, 'POST', `/api/sync/channel/${idA}/send`, { message: request('req-1') })

    const seen = await waitFor(
      () => status(B, idB),
      (s) => s.received.length > 0,
      { intervalMs: 100, label: 'B to receive the frame' },
    )
    expect(seen.received[0]).toEqual(request('req-1'))

    // The sender never hears its own frame — the pull protocol depends on it,
    // since both sides sit on one topic.
    expect((await status(A, idA)).received).toEqual([])
  })

  it('a joiner with the wrong room secret cannot read the traffic', async () => {
    const room = newRoom()
    const wrong = newRoom()
    // Same room id, different secret: the eavesdropper is on the topic and the
    // relay hands it every frame. It still gets nothing, because the seal is
    // keyed by the secret and it does not have it.
    const { idA, idB } = await joinPair(room.roomId, room.secret, wrong.secret)

    await api(A, 'POST', `/api/sync/channel/${idA}/send`, { message: request('req-2') })

    // Give the frame every chance to arrive before concluding it didn't.
    await new Promise((resolve) => setTimeout(resolve, 2_000))
    expect((await status(B, idB)).received).toEqual([])
  })

  it('tears down over the API and re-joins the same room', async () => {
    const room = newRoom()
    const first = await joinPair(room.roomId, room.secret, room.secret)

    await api(A, 'DELETE', `/api/sync/channel/${first.idA}`)
    await expect(status(A, first.idA)).rejects.toThrow(/404/)

    // No member slots and no room registry any more: re-joining is immediate,
    // with nothing to reclaim first (the old relay's 'room full' class of
    // failure has no analogue here).
    const again = await joinPair(room.roomId, room.secret, room.secret)
    await api(A, 'POST', `/api/sync/channel/${again.idA}/send`, { message: request('req-3') })
    const seen = await waitFor(
      () => status(B, again.idB),
      (s) => s.received.some((m: { requestId?: string }) => m.requestId === 'req-3'),
      { intervalMs: 100, label: 'B to receive the post-rejoin frame' },
    )
    expect(seen.received.at(-1)).toEqual(request('req-3'))
  })
})
