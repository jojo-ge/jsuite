import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startLocalRelay, type LocalRelay } from '@jsuite/relay'
import { api, ok, waitFor } from './helpers'
import { startInstance, type Instance } from './harness/instance'

// TICK-295: ownership transfer end-to-end across two real jTicket instances
// (spec DOC-30 "ownership transfer"). A ticket crosses sides two-phase over
// pull-only snapshots: initiate freezes it on the transferor, the transferee's
// next pull presents it as a pending offer they must explicitly accept before
// it becomes editable or dispatchable, and the transferor's next pull (the
// reverse direction TICK-295 armed) finalizes — or reverts, on a decline.

let relay: LocalRelay
let A: Instance // creator
let B: Instance // importer

beforeAll(async () => {
  relay = await startLocalRelay()
  const env = {
    JTICKET_RELAY_URL: relay.url.href,
    JTICKET_PULL_REQUEST_TTL_MS: '30000',
    JTICKET_PULL_TIMEOUT_MS: '20000',
    JTICKET_SYNC_TICK_MS: '200',
    JTICKET_HANDSHAKE_TIMEOUT_MS: '3000',
  }
  ;[A, B] = await Promise.all([startInstance({ label: 'a', env }), startInstance({ label: 'b', env })])
})

afterAll(async () => {
  await Promise.all([relay?.dispose(), A?.dispose(), B?.dispose()])
})

const terminal = (state: string) => ['applied', 'denied', 'expired', 'failed'].includes(state)

/** One approved pull: `to` asks, `from`'s human approves, `to` applies. */
async function pull(to: Instance, from: Instance, projectId: string) {
  const { pull } = await ok(to, 'POST', `/api/projects/${projectId}/pull`)
  await waitFor(
    async () => (await ok(from, 'GET', '/api/sync/pulls')).pulls,
    (p: Array<{ id: string }>) => p.some((x) => x.id === pull.id),
    { label: `pending approval for ${pull.id}`, timeoutMs: 30_000, intervalMs: 150 },
  )
  await ok(from, 'POST', `/api/sync/pulls/${pull.id}/approve`)
  const done = await waitFor(
    async () => (await ok(to, 'GET', `/api/projects/${projectId}/pull/${pull.id}`)).pull,
    (p: { state: string }) => terminal(p.state),
    { label: `pull ${pull.id} applied`, timeoutMs: 30_000, intervalMs: 150 },
  )
  expect(done.state).toBe('applied')
  return done
}

const ticketOn = async (instance: Instance, key: string) => ok(instance, 'GET', `/api/tickets/${key}`)
const frontierKeys = async (instance: Instance, projectId: string) =>
  (await ok(instance, 'GET', `/api/tickets?projectId=${projectId}&frontier=true`)).map((t: { key: string }) => t.key)

let projectA: { id: string }
let projectB: { id: string }

describe('ownership transfer end-to-end', () => {
  it('sets up the shared pair', async () => {
    projectA = await ok(A, 'POST', '/api/projects', { title: 'Cart rework' })
    const { share } = await ok(A, 'POST', `/api/projects/${projectA.id}/share`, { sharedKey: 'CART', peerName: 'Blake' })
    const imported = await ok(B, 'POST', '/api/shares/import', { fragment: share.link.split('#')[1], peerName: 'Avery' })
    projectB = imported.project
  })

  it('a transferred ticket crosses sides and ends owned by the transferee on both machines', async () => {
    // A mints CART-1 and hands it to Blake (the importer).
    const t = await ok(A, 'POST', '/api/tickets', {
      title: 'Persist the cart', projectId: projectA.id, description: 'localStorage, not cookies',
      acceptanceCriteria: ['survives refresh'],
    })
    expect(t.key).toBe('CART-1')
    await pull(B, A, projectB.id) // Blake has the settled ticket first
    await ok(A, 'POST', `/api/tickets/${t.id}/transfer`)

    // Frozen for the transferor: no edits, no branch, no delete, no dispatch,
    // and off the frontier (AC 5).
    const frozen = await ticketOn(A, 'CART-1')
    expect(frozen).toMatchObject({ owner: 'importer', transfer: 'pending' })
    expect(frozen.transferAt).toBeTruthy()
    expect((await api(A, 'PATCH', '/api/tickets/CART-1', { title: 'nope' })).status).toBe(409)
    expect((await api(A, 'POST', '/api/tickets/CART-1/branch', {})).status).toBe(409)
    expect((await api(A, 'DELETE', '/api/tickets/CART-1')).status).toBe(409)
    expect((await api(A, 'POST', '/api/tickets/CART-1/herdr', { prompt: 'go' })).status).toBe(409)
    expect(await frontierKeys(A, projectA.id)).not.toContain('CART-1')

    // The offer lands on Blake's next pull — full content, still frozen (AC 2).
    await pull(B, A, projectB.id)
    const offer = await ticketOn(B, 'CART-1')
    expect(offer).toMatchObject({
      owner: 'importer', transfer: 'pending', title: 'Persist the cart',
      description: 'localStorage, not cookies', acceptanceCriteria: ['survives refresh'],
    })
    expect((await api(B, 'PATCH', '/api/tickets/CART-1', { title: 'mine now' })).status).toBe(409)
    expect((await api(B, 'POST', '/api/tickets/CART-1/herdr', { prompt: 'go' })).status).toBe(409)
    expect(await frontierKeys(B, projectB.id)).not.toContain('CART-1')

    // Limbo pulls in BOTH directions neither delete nor duplicate (AC 4).
    await pull(B, A, projectB.id)
    const onB = await ok(B, 'GET', `/api/tickets?projectId=${projectB.id}`)
    expect(onB.filter((x: { key: string }) => x.key === 'CART-1')).toHaveLength(1)
    expect(onB.find((x: { key: string }) => x.key === 'CART-1').transfer).toBe('pending')
    await pull(A, B, projectA.id)
    const onA = await ok(A, 'GET', `/api/tickets?projectId=${projectA.id}`)
    expect(onA.filter((x: { key: string }) => x.key === 'CART-1')).toHaveLength(1)
    expect(onA.find((x: { key: string }) => x.key === 'CART-1').transfer).toBe('pending')

    // Only an explicit accept makes it Blake's — then it's editable,
    // dispatchable-frontier, and exported as theirs (AC 2).
    await ok(B, 'POST', '/api/tickets/CART-1/transfer/accept')
    const accepted = await ticketOn(B, 'CART-1')
    expect(accepted).toMatchObject({ owner: 'importer', transfer: '', transferAt: '' })
    expect((await ok(B, 'PATCH', '/api/tickets/CART-1', { title: 'Persist the cart (mine)' })).title)
      .toBe('Persist the cart (mine)')
    expect(await frontierKeys(B, projectB.id)).toContain('CART-1')

    // The transferor's next pull finalizes: owned by the transferee on both
    // machines, read-only on the original side (AC 1).
    await pull(A, B, projectA.id)
    const finalized = await ticketOn(A, 'CART-1')
    expect(finalized).toMatchObject({ owner: 'importer', transfer: '', title: 'Persist the cart (mine)', origin: 'creator' })
    expect((await api(A, 'PATCH', '/api/tickets/CART-1', { title: 'take it back' })).status).toBe(403)
  })

  it('a decline returns ownership to the original side on the next pull', async () => {
    const t = await ok(A, 'POST', '/api/tickets', { title: 'Wire the totals endpoint', projectId: projectA.id })
    expect(t.key).toBe('CART-3')
    await ok(A, 'POST', `/api/tickets/${t.id}/transfer`)

    await pull(B, A, projectB.id)
    expect((await ticketOn(B, 'CART-3')).transfer).toBe('pending')
    await ok(B, 'POST', '/api/tickets/CART-3/transfer/decline')
    const declined = await ticketOn(B, 'CART-3')
    expect(declined).toMatchObject({ owner: 'creator', transfer: 'declined' })

    // The stale offer keeps arriving until A hears the decline — it must not
    // resurrect, and the ticket must not duplicate.
    await pull(B, A, projectB.id)
    const onB = await ok(B, 'GET', `/api/tickets?projectId=${projectB.id}`)
    expect(onB.filter((x: { key: string }) => x.key === 'CART-3')).toHaveLength(1)
    expect(onB.find((x: { key: string }) => x.key === 'CART-3').transfer).toBe('declined')

    // A's next pull bounces it back: theirs again, unfrozen (AC 3).
    await pull(A, B, projectA.id)
    const bounced = await ticketOn(A, 'CART-3')
    expect(bounced).toMatchObject({ owner: 'creator', transfer: '', transferAt: '' })
    expect((await ok(A, 'PATCH', '/api/tickets/CART-3', { title: 'Totals endpoint (kept)' })).title)
      .toBe('Totals endpoint (kept)')

    // And Blake's next pull clears the decline marker into a plain peer copy.
    await pull(B, A, projectB.id)
    expect(await ticketOn(B, 'CART-3')).toMatchObject({ owner: 'creator', transfer: '', title: 'Totals endpoint (kept)' })
  })

  it('transfer endpoints refuse the wrong side and the wrong state', async () => {
    // Initiating on a ticket you don't own, or accepting nothing: state
    // conflicts, refused at the API.
    expect((await api(B, 'POST', '/api/tickets/CART-3/transfer')).status).toBe(409)

    const t = await ok(A, 'POST', '/api/tickets', { title: 'Checkout copy pass', projectId: projectA.id })
    expect((await api(A, 'POST', `/api/tickets/${t.id}/transfer/accept`)).status).toBe(409)
    await ok(A, 'POST', `/api/tickets/${t.id}/transfer`)
    // The transferor cannot answer their own offer.
    expect((await api(A, 'POST', `/api/tickets/${t.id}/transfer/accept`)).status).toBe(409)
    expect((await api(A, 'POST', `/api/tickets/${t.id}/transfer/decline`)).status).toBe(409)
    // And a ticket already in transfer cannot be re-initiated.
    expect((await api(A, 'POST', `/api/tickets/${t.id}/transfer`)).status).toBe(409)
  })
})
