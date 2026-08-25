import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startLocalRelay, type LocalRelay } from '@jsuite/relay'
import { sleep, waitFor } from './helpers'
import { startInstance, type Instance } from './harness/instance'

// TICK-294's tracer bullet: the pull flow end-to-end across two real jTicket
// instances and a local relay. The importer clicks Sync (POST pull), a request
// travels over the data channel, the serving side sees a pending approval
// naming who is asking and for what, and on approve the snapshot travels, the
// importer applies it and reads the change summary. Denied and unanswered
// requests transfer nothing; in-flight pulls complete across link expiry; new
// requests after expiry cannot dial.

// Long enough that a pending request survives the link-expiry test's wait
// (the link there lives 4s), short enough that the unanswered-request test
// doesn't drag.
const REQUEST_TTL_MS = 6_000

let relay: LocalRelay
let A: Instance // creator — serves pulls
let B: Instance // importer — requests pulls

beforeAll(async () => {
  relay = await startLocalRelay()
  const env = {
    JTICKET_SYNC_RELAY_URL: relay.url,
    JTICKET_PULL_REQUEST_TTL_MS: String(REQUEST_TTL_MS),
    JTICKET_PULL_TIMEOUT_MS: '20000',
    JTICKET_SYNC_TICK_MS: '200',
    JTICKET_PULL_ACK_TIMEOUT_MS: '10000',
    JTICKET_PULL_RETRY_MS: '250',
  }
  ;[A, B] = await Promise.all([startInstance({ label: 'a', env }), startInstance({ label: 'b', env })])
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

async function apiStatus(instance: Instance, method: string, path: string, body?: unknown): Promise<number> {
  const res = await fetch(`${instance.url}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  await res.text()
  return res.status
}

function fragmentOf(link: string): string {
  return link.split('#')[1]!
}

const terminal = (state: string) => ['applied', 'denied', 'expired', 'failed'].includes(state)

async function runPull(importerProjectId: string) {
  const { pull } = await api(B, 'POST', `/api/projects/${importerProjectId}/pull`)
  return pull as { id: string; state: string }
}

function waitForPull(importerProjectId: string, pullId: string, label: string) {
  return waitFor(
    async () => (await api(B, 'GET', `/api/projects/${importerProjectId}/pull/${pullId}`)).pull,
    (p: { state: string }) => terminal(p.state),
    { label, timeoutMs: 30_000, intervalMs: 150 },
  )
}

let projectA: { id: string; key: string }
let projectB: { id: string }

describe('pull flow end-to-end', () => {
  it('an approved pull lands the peer half on the importer, with the change summary', async () => {
    // The creator's board: a project, two tickets, a doc with a body.
    projectA = await api(A, 'POST', '/api/projects', { title: 'Cart rework', description: 'the plan' })
    await api(A, 'POST', '/api/tickets', { title: 'Persist the cart', projectId: projectA.id, description: 'big'.repeat(20_000) })
    await api(A, 'POST', '/api/tickets', { title: 'Wire the totals endpoint', projectId: projectA.id })
    await api(A, 'POST', '/api/docs', {
      title: 'Cart sync notes',
      projectId: projectA.id,
      blocks: [{ type: 'prose', md: 'The cart syncs via **snapshots**.' }],
    })

    // Share on A — arming the creator side at share time (TICK-302) — then import on B.
    const { share } = await api(A, 'POST', `/api/projects/${projectA.id}/share`, { sharedKey: 'CART', peerName: 'Blake' })
    const imported = await api(B, 'POST', '/api/shares/import', { fragment: fragmentOf(share.link), peerName: 'Avery' })
    projectB = imported.project

    // B clicks Sync.
    const pull = await runPull(projectB.id)

    // A sees a pending approval naming who is asking and for what.
    const pending = await waitFor(
      async () => (await api(A, 'GET', '/api/sync/pulls')).pulls,
      (p: Array<{ id: string }>) => p.length === 1,
      { label: 'pending approval on A', timeoutMs: 30_000, intervalMs: 150 },
    )
    expect(pending[0].id).toBe(pull.id)
    expect(pending[0].requester).toBe('Blake')
    expect(pending[0].projectId).toBe(projectA.id)
    expect(pending[0].projectKey).toBe(projectA.key)
    expect(pending[0].projectTitle).toBe('Cart rework')

    // Approve on A — the snapshot travels and B applies it.
    await api(A, 'POST', `/api/sync/pulls/${pull.id}/approve`)
    const done = await waitForPull(projectB.id, pull.id, 'pull applied on B')
    expect(done.state).toBe('applied')
    expect(done.summary.tickets.added).toHaveLength(2)
    expect(done.summary.docs.added).toHaveLength(1)

    // The board updated: the creator's half landed, project metadata included.
    const updated = await api(B, 'GET', `/api/projects/${projectB.id}`)
    expect(updated.title).toBe('Cart rework')
    const ticketsOnB = await api(B, 'GET', `/api/tickets?projectId=${projectB.id}`)
    expect(ticketsOnB.map((t: { title: string }) => t.title).sort()).toEqual([
      'Persist the cart',
      'Wire the totals endpoint',
    ])
    // The long description survived chunking byte-for-byte.
    expect(ticketsOnB.find((t: { title: string }) => t.title === 'Persist the cart').description).toBe('big'.repeat(20_000))
    const docsOnB = await api(B, 'GET', `/api/docs?projectId=${projectB.id}`)
    expect(docsOnB).toHaveLength(1)
    const body = await api(B, 'GET', `/api/documents/${docsOnB[0].documentKey}`)
    expect(JSON.stringify(body.blocks)).toContain('snapshots')

    // Machine-local fields never crossed: B's repo/branch stay its own.
    expect(updated.repo).toBe('')
    expect(updated.integrationBranch).toBe('')

    // The peer's half is not the importer's to take (TICK-310): both settled
    // creator-owned tickets are read-only and undispatchable here, so B's
    // frontier is empty and every derived flag says so.
    expect(await api(B, 'GET', `/api/tickets?projectId=${projectB.id}&frontier=true`)).toEqual([])
    expect(ticketsOnB.map((t: { frontier: boolean }) => t.frontier)).toEqual([false, false])
    expect((await api(B, 'GET', `/api/tickets/${ticketsOnB[0].key}`)).frontier).toBe(false)

    // A second pull is idempotent — the presence loop re-armed, nothing changes.
    const again = await runPull(projectB.id)
    await waitFor(
      async () => (await api(A, 'GET', '/api/sync/pulls')).pulls,
      (p: Array<{ id: string }>) => p.some((x) => x.id === again.id),
      { label: 'second pending on A', timeoutMs: 30_000, intervalMs: 150 },
    )
    await api(A, 'POST', `/api/sync/pulls/${again.id}/approve`)
    const secondDone = await waitForPull(projectB.id, again.id, 'second pull applied')
    expect(secondDone.state).toBe('applied')
    expect(secondDone.summary.tickets.added).toHaveLength(0)
    expect(secondDone.summary.tickets.changed).toHaveLength(0)
    expect(secondDone.summary.docs.added).toHaveLength(0)
  })

  // "Zero project data" for AC 2: everything a pull could move — tickets,
  // docs, and creator project metadata.
  async function boardSnapshot() {
    return {
      tickets: await api(B, 'GET', `/api/tickets?projectId=${projectB.id}`),
      docs: await api(B, 'GET', `/api/docs?projectId=${projectB.id}`),
      project: await api(B, 'GET', `/api/projects/${projectB.id}`),
    }
  }

  it('a denied pull transfers nothing', async () => {
    await api(A, 'POST', '/api/tickets', { title: 'not yet shared work', projectId: projectA.id })
    await api(A, 'POST', '/api/docs', { title: 'not yet shared doc', projectId: projectA.id, blocks: [] })
    await api(A, 'PATCH', `/api/projects/${projectA.id}`, { title: 'Cart rework v2' })
    const before = await boardSnapshot()

    const pull = await runPull(projectB.id)
    await waitFor(
      async () => (await api(A, 'GET', '/api/sync/pulls')).pulls,
      (p: Array<{ id: string }>) => p.some((x) => x.id === pull.id),
      { label: 'pending deny on A', timeoutMs: 30_000, intervalMs: 150 },
    )
    await api(A, 'POST', `/api/sync/pulls/${pull.id}/deny`)

    const done = await waitForPull(projectB.id, pull.id, 'pull denied on B')
    expect(done.state).toBe('denied')
    const after = await boardSnapshot()
    expect(after.tickets).toHaveLength(before.tickets.length)
    expect(after.tickets.map((t: { title: string }) => t.title)).not.toContain('not yet shared work')
    expect(after.docs).toHaveLength(before.docs.length)
    expect(after.project.title).toBe(before.project.title)
  })

  it('an unanswered request expires and transfers nothing', async () => {
    const before = await boardSnapshot()

    const pull = await runPull(projectB.id)
    const done = await waitForPull(projectB.id, pull.id, 'pull expires unanswered')
    expect(done.state).toBe('expired')

    const { pulls } = await api(A, 'GET', '/api/sync/pulls')
    expect(pulls).toHaveLength(0)
    const after = await boardSnapshot()
    expect(after.tickets).toHaveLength(before.tickets.length)
    expect(after.docs).toHaveLength(before.docs.length)
    expect(after.project.title).toBe(before.project.title)
  })

  it('a pull approved just before link expiry completes; a new request after expiry cannot dial', async () => {
    // Re-arm the share with a short window and re-import the fresh link on B.
    const ttlMs = 4_000
    const { share } = await api(A, 'POST', `/api/projects/${projectA.id}/share`, { sharedKey: 'CART', ttlMs })
    const expiresAt = Date.parse(share.expiresAt)
    await api(B, 'POST', '/api/shares/import', { fragment: fragmentOf(share.link) })

    // Request while the link is alive…
    const pull = await runPull(projectB.id)
    await waitFor(
      async () => (await api(A, 'GET', '/api/sync/pulls')).pulls,
      (p: Array<{ id: string }>) => p.some((x) => x.id === pull.id),
      { label: 'pending before expiry', timeoutMs: 30_000, intervalMs: 150 },
    )

    // …approve after it expired: the in-flight pull still completes.
    await sleep(Math.max(0, expiresAt - Date.now()) + 500)
    await api(A, 'POST', `/api/sync/pulls/${pull.id}/approve`)
    const done = await waitForPull(projectB.id, pull.id, 'in-flight pull across expiry')
    expect(done.state).toBe('applied')

    // A brand-new request after expiry cannot even dial.
    expect(await apiStatus(B, 'POST', `/api/projects/${projectB.id}/pull`)).toBe(410)
  })
})
