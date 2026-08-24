import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { api, ok } from './helpers'
import { startInstance, type Instance } from './harness/instance'

// The creator side of the share flow (spec DOC-30, TICK-302): sharing a
// project must arm it — set project.share so parity minting and ownership
// partitioning take effect on the creator's machine — and stamp the entities
// that predate the share with the creator side. The importer half of this is
// covered by import.e2e.test.ts.

let A: Instance
let B: Instance

beforeAll(async () => {
  ;[A, B] = await Promise.all([startInstance({ label: 'share-a' }), startInstance({ label: 'share-b' })])
})

afterAll(async () => {
  await Promise.all([A?.dispose(), B?.dispose()])
})

describe('arming the creator side at share time', () => {
  it('first share arms project.share and stamps pre-existing entities with the creator side', async () => {
    const project = await ok(A, 'POST', '/api/projects', { title: 'Billing revamp' })
    const preTicket = await ok(A, 'POST', '/api/tickets', { title: 'pre-share ticket', projectId: project.id })
    await ok(A, 'POST', `/api/tickets/${preTicket.id}/comments`, { author: 'jo', body: 'before the share' })
    const preDoc = await ok(A, 'POST', '/api/docs', { title: 'pre-share doc', projectId: project.id })

    await ok(A, 'POST', `/api/projects/${project.id}/share`, { sharedKey: 'BILL', peerName: 'Sam' })

    // AC: project.share armed with side creator and the coworker's name.
    const armed = await ok(A, 'GET', `/api/projects/${project.id}`)
    expect(armed.share).toEqual({ key: 'BILL', side: 'creator', peerName: 'Sam' })

    // AC: entities from before the share are stamped creator — comments too.
    const ticket = await ok(A, 'GET', `/api/tickets/${preTicket.id}`)
    expect(ticket).toMatchObject({ origin: 'creator', owner: 'creator' })
    expect(ticket.comments[0]).toMatchObject({ origin: 'creator', owner: 'creator' })
    const doc = await ok(A, 'GET', `/api/docs/${preDoc.id}`)
    expect(doc).toMatchObject({ origin: 'creator', owner: 'creator' })

    // AC: tickets minted after sharing take odd parity keys under the shared
    // key (the pre-share ticket keeps its local key).
    const t1 = await ok(A, 'POST', '/api/tickets', { title: 'first post-share ticket', projectId: project.id })
    const t2 = await ok(A, 'POST', '/api/tickets', { title: 'second post-share ticket', projectId: project.id })
    expect(t1.key).toBe('BILL-1')
    expect(t2.key).toBe('BILL-3')
    expect(t1).toMatchObject({ origin: 'creator', owner: 'creator' })
    expect(ticket.key).toBe(preTicket.key)
  })

  it("requires the coworker's name on first share; a re-share keeps it without one", async () => {
    const project = await ok(A, 'POST', '/api/projects', { title: 'Search relaunch' })
    const nameless = await api(A, 'POST', `/api/projects/${project.id}/share`, { sharedKey: 'SRCH' })
    expect(nameless.status).toBe(400)
    expect(nameless.body.statusMessage ?? nameless.body.message).toMatch(/name/i)

    await ok(A, 'POST', `/api/projects/${project.id}/share`, { sharedKey: 'SRCH', peerName: 'Sam' })
    await ok(A, 'POST', `/api/projects/${project.id}/share`, {})
    const rearmed = await ok(A, 'GET', `/api/projects/${project.id}`)
    expect(rearmed.share).toEqual({ key: 'SRCH', side: 'creator', peerName: 'Sam' })
  })

  it('refuses to share a project this machine imported — the share is the creator’s', async () => {
    const project = await ok(A, 'POST', '/api/projects', { title: 'Payments' })
    const { share } = await ok(A, 'POST', `/api/projects/${project.id}/share`, { sharedKey: 'PAY', peerName: 'Ana' })
    const { project: imported } = await ok(B, 'POST', '/api/shares/import', {
      fragment: share.link.split('#')[1]!,
      peerName: 'Jo',
    })

    const res = await api(B, 'POST', `/api/projects/${imported.id}/share`, {})
    expect(res.status).toBe(409)
    expect(res.body.statusMessage ?? res.body.message).toMatch(/creator/)
  })
})
