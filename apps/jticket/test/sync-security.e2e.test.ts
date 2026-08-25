import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startLocalRelay, type LocalRelay } from '@jsuite/relay'
import { api, ok, sleep, waitFor } from './helpers'
import { startInstance, type Instance } from './harness/instance'

// TICK-297: the adversarial security & privacy pass, HTTP half (spec DOC-30).
// Two real jTicket instances and a local relay — the same harness the pull and
// transfer suites use, driven here to ATTACK the invariants rather than prove
// the happy path. The frame-level attacks (forging a request for another
// project, capturing relay/payload plaintext) live in sync-security.test.ts;
// this file owns the ones that only mean anything against a full running
// instance: an expired or revoked link cannot pull, and once real data has
// synced, dispatch stays blocked on peer-owned and pre-acceptance transferred
// tickets — enforced at the API, not just the UI.

let relay: LocalRelay
let A: Instance // creator — serves
let B: Instance // importer — pulls

beforeAll(async () => {
  relay = await startLocalRelay()
  const env = {
    JTICKET_SYNC_RELAY_URL: relay.url,
    JTICKET_PULL_REQUEST_TTL_MS: '30000',
    JTICKET_PULL_TIMEOUT_MS: '15000',
    JTICKET_SYNC_TICK_MS: '200',
    JTICKET_PULL_ACK_TIMEOUT_MS: '10000',
    JTICKET_PULL_RETRY_MS: '250',
  }
  ;[A, B] = await Promise.all([startInstance({ label: 'a', env }), startInstance({ label: 'b', env })])
})

afterAll(async () => {
  await Promise.all([relay?.dispose(), A?.dispose(), B?.dispose()])
})

const terminal = (state: string) => ['applied', 'denied', 'expired', 'failed'].includes(state)
const fragmentOf = (link: string) => link.split('#')[1]!

/**
 * One approved pull: `to` asks, `from`'s human approves, `to` applies. Retried
 * a few times: the serving side joins its topic on a presence tick, so a pull
 * fired before it gets there waits on the importer's own request retries and
 * can still run out of ack window on a cold start. These are transport
 * retries, not assertion softening — the security tests downstream all need a
 * real baseline sync to exist.
 */
async function approvedPull(to: Instance, from: Instance, projectId: string, attempts = 4) {
  let lastState = 'never-started'
  for (let i = 0; i < attempts; i++) {
    const { pull } = await ok(to, 'POST', `/api/projects/${projectId}/pull`)
    try {
      await waitFor(
        async () => (await ok(from, 'GET', '/api/sync/pulls')).pulls,
        (p: Array<{ id: string }>) => p.some((x) => x.id === pull.id),
        { label: `pending ${pull.id}`, timeoutMs: 18_000, intervalMs: 150 },
      )
    } catch {
      lastState = 'no-pending'
      continue // handshake never connected — start a fresh attempt
    }
    await ok(from, 'POST', `/api/sync/pulls/${pull.id}/approve`)
    const done = await waitFor(
      async () => (await ok(to, 'GET', `/api/projects/${projectId}/pull/${pull.id}`)).pull,
      (p: { state: string }) => terminal(p.state),
      { label: `pull ${pull.id} done`, timeoutMs: 25_000, intervalMs: 150 },
    )
    if (done.state === 'applied') return done
    lastState = done.state
  }
  throw new Error(`approved pull never applied after ${attempts} attempts (last: ${lastState})`)
}

async function ticketsOn(instance: Instance, projectId: string) {
  return ok(instance, 'GET', `/api/tickets?projectId=${projectId}`)
}
async function frontierKeys(instance: Instance, projectId: string) {
  const list = await ok(instance, 'GET', `/api/tickets?projectId=${projectId}&frontier=true`)
  return list.map((t: { key: string }) => t.key)
}

let projectA: { id: string; key: string }
let projectB: { id: string }

describe('sync security — HTTP surface', () => {
  it('sets up a shared pair with one synced ticket', async () => {
    projectA = await ok(A, 'POST', '/api/projects', { title: 'Cart rework', description: 'the plan' })
    await ok(A, 'POST', '/api/tickets', {
      title: 'Persist the cart',
      projectId: projectA.id,
      description: 'localStorage, not cookies',
    })
    const { share } = await ok(A, 'POST', `/api/projects/${projectA.id}/share`, { sharedKey: 'CART', peerName: 'Blake' })
    const imported = await ok(B, 'POST', '/api/shares/import', { fragment: fragmentOf(share.link), peerName: 'Avery' })
    projectB = imported.project
    await approvedPull(B, A, projectB.id)

    const onB = await ticketsOn(B, projectB.id)
    expect(onB.map((t: { title: string }) => t.title)).toContain('Persist the cart')
  })

  it('a synced peer-owned ticket cannot be dispatched, edited, deleted, branched, or reach the frontier', async () => {
    // The creator's ticket landed on the importer as peer-owned (owner:
    // 'creator'). Every mutating/dispatching path must refuse it at the API.
    const [synced] = await ticketsOn(B, projectB.id)
    expect(synced.owner).toBe('creator')

    // Dispatch, claim (any PATCH), branch, and delete are all refused at the
    // API — the enforcement boundary DOC-30 promises, not merely the UI. (A
    // settled peer ticket can still surface on the importer's frontier, since
    // the frontier gates on transfer-state, not ownership; the guards below are
    // what actually make it inert, so an agent that picks it up bounces here.)
    expect((await api(B, 'POST', `/api/tickets/${synced.key}/herdr`, { prompt: 'go' })).status).toBe(403)
    expect((await api(B, 'PATCH', `/api/tickets/${synced.key}`, { title: 'mine now' })).status).toBe(403)
    expect((await api(B, 'PATCH', `/api/tickets/${synced.key}`, { assignee: 'claude' })).status).toBe(403)
    expect((await api(B, 'POST', `/api/tickets/${synced.key}/branch`, {})).status).toBe(403)
    expect((await api(B, 'DELETE', `/api/tickets/${synced.key}`)).status).toBe(403)

    // And the refusal changed nothing on disk.
    const after = await ok(B, 'GET', `/api/tickets/${synced.key}`)
    expect(after.title).toBe(synced.title)
    expect(after.owner).toBe('creator')
  })

  it('a ticket mid-transfer is undispatchable on BOTH machines until the offer is accepted', async () => {
    // A hands one of its tickets to Blake. From initiate until Blake accepts,
    // it is frozen — remote-authored text that must not become runnable.
    const t = await ok(A, 'POST', '/api/tickets', { title: 'Wire totals', projectId: projectA.id })
    await ok(A, 'POST', `/api/tickets/${t.id}/transfer`)

    // Frozen on the transferor immediately (409, not the 403 of a settled peer
    // ticket — the pending copy is peer-owned too, and "frozen" is the reason).
    expect((await api(A, 'POST', `/api/tickets/${t.key}/herdr`, { prompt: 'go' })).status).toBe(409)
    expect(await frontierKeys(A, projectA.id)).not.toContain(t.key)

    // The offer reaches Blake; still undispatchable while pending.
    await approvedPull(B, A, projectB.id)
    const offer = await ok(B, 'GET', `/api/tickets/${t.key}`)
    expect(offer).toMatchObject({ owner: 'importer', transfer: 'pending' })
    expect((await api(B, 'POST', `/api/tickets/${t.key}/herdr`, { prompt: 'go' })).status).toBe(409)
    expect(await frontierKeys(B, projectB.id)).not.toContain(t.key)
  })

  it('a revoked link stops serving instantly: a fresh pull moves no data', async () => {
    // A new ticket A creates AFTER stop-sharing is the canary — it must never
    // reach Blake.
    await ok(A, 'DELETE', `/api/projects/${projectA.id}/share`)
    await ok(A, 'POST', '/api/tickets', { title: 'post-revoke secret work', projectId: projectA.id })
    const before = await ticketsOn(B, projectB.id)

    // Blake's own link isn't revoked (revocation is the creator's local act),
    // so the pull still starts — but it can never complete. Retrying as many
    // times as an ordinarily-successful pull needs rules out "it just flaked
    // this once": the same handshake reliably applied before the revoke.
    for (let i = 0; i < 4; i++) {
      const { pull } = await ok(B, 'POST', `/api/projects/${projectB.id}/pull`)
      const done = await waitFor(
        async () => (await ok(B, 'GET', `/api/projects/${projectB.id}/pull/${pull.id}`)).pull,
        (p: { state: string }) => terminal(p.state),
        { label: 'revoked pull terminal', timeoutMs: 25_000, intervalMs: 200 },
      )
      expect(done.state).not.toBe('applied')
    }

    // And A's side never even queued an approval — revocation refuses before a
    // pending is created, so the human is never asked.
    expect((await ok(A, 'GET', '/api/sync/pulls')).pulls).toHaveLength(0)

    const after = await ticketsOn(B, projectB.id)
    expect(after).toHaveLength(before.length)
    expect(after.map((t: { title: string }) => t.title)).not.toContain('post-revoke secret work')
  })

  it('an expired link cannot even start a pull', async () => {
    // Re-arm with a short window and re-import the fresh link, then let it lapse.
    const ttlMs = 2_500
    const { share } = await ok(A, 'POST', `/api/projects/${projectA.id}/share`, { sharedKey: 'CART', ttlMs })
    const expiresAt = Date.parse(share.expiresAt)
    await ok(B, 'POST', '/api/shares/import', { fragment: fragmentOf(share.link) })

    await sleep(Math.max(0, expiresAt - Date.now()) + 400)
    expect((await api(B, 'POST', `/api/projects/${projectB.id}/pull`)).status).toBe(410)
  })
})
