import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startLocalRelay, type LocalRelay } from '@jsuite/relay'
import type { PeerStatus } from '../server/utils/peer'
import { createRoom, waitFor } from './helpers'
import { startInstance, type Instance } from './harness/instance'

// The two-instance harness — TICK-289's end-to-end slice. Two real jTicket
// server processes and a local relay in one run: instance A dials instance B
// through the relay and opens a data channel, driven entirely through each
// instance's local HTTP API. No browser anywhere. Real traffic over the
// channel is the pull flow's job (sync-pull.e2e.test.ts) — the raw peer API
// carries no message affordances since TICK-294.

let relay: LocalRelay
let A: Instance
let B: Instance

beforeAll(async () => {
  ;[relay, A, B] = await Promise.all([startLocalRelay(), startInstance({ label: 'a' }), startInstance({ label: 'b' })])
})

afterAll(async () => {
  await Promise.all([relay?.dispose(), A?.dispose(), B?.dispose()])
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

function waitForPeer(
  instance: Instance,
  id: string,
  predicate: (status: { state: string }) => boolean,
  options?: { label?: string },
) {
  return waitFor(() => api(instance, 'GET', `/api/sync/peer/${id}`), predicate, { intervalMs: 100, ...options })
}

/**
 * One connected pair, retried — the two-instance mirror of peer.test.ts's
 * connectInRoom (TICK-308). A same-host dial can die mid-DTLS, and a re-dial
 * can land on a room slot the relay has not reclaimed yet; either way the
 * attempt is transient, so drop both halves and ask for a fresh room rather
 * than failing the test on one unlucky handshake (TICK-300, TICK-311). The
 * initiator is the side with a definite verdict — its handshake timer fires —
 * so its status decides whether the attempt proved out.
 */
async function connectPair(attempts = 5) {
  let lastA: PeerStatus | undefined
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const { roomId, secret } = await createRoom(relay)
    const relayUrl = relay.url.href
    const { id: idB } = await api(B, 'POST', '/api/sync/peer', { relayUrl, roomId, secret, initiator: false })
    const { id: idA } = await api(A, 'POST', '/api/sync/peer', { relayUrl, roomId, secret, initiator: true })
    lastA = await waitForPeer(A, idA, (s) => s.state !== 'connecting', { label: `A settled (attempt ${attempt})` })
    if (lastA.state === 'connected') {
      await waitForPeer(B, idB, (s) => s.state === 'connected', { label: `B connected (attempt ${attempt})` })
      return { idA, idB, roomId, secret }
    }
    await Promise.all([
      api(A, 'DELETE', `/api/sync/peer/${idA}`),
      api(B, 'DELETE', `/api/sync/peer/${idB}`),
    ])
  }
  throw new Error(`no connected pair after ${attempts} attempts; last A status: ${JSON.stringify(lastA)}`)
}

describe('two jTicket instances over the local relay', () => {
  it('A dials B and both sides open the data channel', async () => {
    const { idA, idB } = await connectPair()
    expect((await api(A, 'GET', `/api/sync/peer/${idA}`)).state).toBe('connected')
    expect((await api(B, 'GET', `/api/sync/peer/${idB}`)).state).toBe('connected')
  })

  it('tears down over the API and re-dials through a fresh handshake', async () => {
    const first = await connectPair()

    await api(A, 'DELETE', `/api/sync/peer/${first.idA}`)
    const closedA = await api(A, 'GET', `/api/sync/peer/${first.idA}`)
    expect(closedA.state).toBe('closed')
    await waitForPeer(B, first.idB, (s) => s.state === 'closed', { label: 'B sees the close' })

    const again = await connectPair()
    expect((await api(A, 'GET', `/api/sync/peer/${again.idA}`)).state).toBe('connected')
  })
})
