import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startLocalRelay, type LocalRelay } from '@jsuite/relay'
import { createRoom, waitFor } from './helpers'
import { startInstance, type Instance } from './harness/instance'

// The two-instance harness — TICK-289's end-to-end slice. Two real jTicket
// server processes and a local relay in one run: instance A dials instance B
// through the relay and round-trips bytes over the data channel, driven
// entirely through each instance's local HTTP API. No browser anywhere.

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
  predicate: (status: { state: string; received: string[] }) => boolean,
  options?: { label?: string },
) {
  return waitFor(() => api(instance, 'GET', `/api/sync/peer/${id}`), predicate, { intervalMs: 100, ...options })
}

async function connectPair() {
  const { roomId, secret } = await createRoom(relay)
  const relayUrl = relay.url.href
  const { id: idB } = await api(B, 'POST', '/api/sync/peer', {
    relayUrl,
    roomId,
    secret,
    initiator: false,
    echo: true,
  })
  const { id: idA } = await api(A, 'POST', '/api/sync/peer', { relayUrl, roomId, secret, initiator: true })
  await waitForPeer(A, idA, (s) => s.state === 'connected', { label: 'A connected' })
  await waitForPeer(B, idB, (s) => s.state === 'connected', { label: 'B connected' })
  return { idA, idB, roomId, secret }
}

describe('two jTicket instances over the local relay', () => {
  it('A dials B and round-trips bytes over the data channel', async () => {
    const { idA, idB } = await connectPair()

    await api(A, 'POST', `/api/sync/peer/${idA}/send`, { data: 'ping-across-processes' })
    const echoed = await waitForPeer(A, idA, (s) => s.received.length > 0, { label: 'echo back at A' })
    expect(echoed.received).toEqual(['ping-across-processes'])

    const atB = await api(B, 'GET', `/api/sync/peer/${idB}`)
    expect(atB.received).toEqual(['ping-across-processes'])
  })

  it('tears down over the API and re-dials through a fresh handshake', async () => {
    const first = await connectPair()

    await api(A, 'DELETE', `/api/sync/peer/${first.idA}`)
    const closedA = await api(A, 'GET', `/api/sync/peer/${first.idA}`)
    expect(closedA.state).toBe('closed')
    await waitForPeer(B, first.idB, (s) => s.state === 'closed', { label: 'B sees the close' })

    const again = await connectPair()
    await api(A, 'POST', `/api/sync/peer/${again.idA}/send`, { data: 'after-redial' })
    const echoed = await waitForPeer(A, again.idA, (s) => s.received.length > 0, { label: 'echo after re-dial' })
    expect(echoed.received).toEqual(['after-redial'])
  })
})
