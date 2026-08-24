import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startLocalRelay, type LocalRelay } from '@jsuite/relay'
import { waitFor } from './helpers'
import { startInstance, type Instance } from './harness/instance'

// TICK-298: the wizard-written .data/jticket/sync.json is enough for a real
// share to use the relay — no JTICKET_RELAY_URL env — and a machine with no
// relay configured at all degrades to clear errors, never a crash.
//
// A boots with the config file only (env explicitly blank, which
// syncRelayUrl() must treat as unset); B boots with nothing.

let relay: LocalRelay
let A: Instance // relay wired via sync.json — the wizard's output
let B: Instance // no relay configured at all

// The URL as the wizard writes it — trailing slash stripped.
const relayBase = () => relay.url.href.replace(/\/$/, '')

beforeAll(async () => {
  relay = await startLocalRelay()
  ;[A, B] = await Promise.all([
    startInstance({ label: 'cfg', env: { JTICKET_RELAY_URL: '', JTICKET_SYNC_TICK_MS: '200' } }),
    startInstance({ label: 'bare', env: { JTICKET_RELAY_URL: '' } }),
  ])
  mkdirSync(join(A.dataDir, 'jticket'), { recursive: true })
  writeFileSync(join(A.dataDir, 'jticket', 'sync.json'), JSON.stringify({ relayUrl: relayBase() }))
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

describe('relay config from sync.json (no env)', () => {
  it('the server reads the file — and picked it up without a restart', async () => {
    const status = await api(A, 'GET', '/api/sync/relay')
    expect(status).toEqual({ relayUrl: relayBase(), configured: true })
  })

  it('a real share registers its room on the file-configured relay', async () => {
    const project = await api(A, 'POST', '/api/projects', { title: 'Wizard-wired' })
    const { share } = await api(A, 'POST', `/api/projects/${project.id}/share`, { sharedKey: 'WIZ', peerName: 'Bo' })
    expect(share.link).toContain('#')
    // The room exists on the relay only if A dialed out with the sync.json
    // URL; its kill switch answers 404 for unknown rooms, 204 once created.
    await waitFor(
      async () => {
        const res = await fetch(new URL(`/rooms/${share.roomId}?secret=${share.roomSecret}`, relay.url), { method: 'DELETE' })
        await res.text()
        return res.status
      },
      (status) => status === 204,
      { timeoutMs: 10_000, label: 'the share room to exist on the relay' },
    )
  })
})

describe('no relay configured anywhere', () => {
  it('says so', async () => {
    const status = await api(B, 'GET', '/api/sync/relay')
    expect(status).toEqual({ relayUrl: '', configured: false })
  })

  it('a pull refuses with a clear 503 naming the wizard — no crash', async () => {
    // B imports A's share so it holds the pulling (importer) side.
    const project = await api(A, 'POST', '/api/projects', { title: 'Unreachable' })
    const { share } = await api(A, 'POST', `/api/projects/${project.id}/share`, { sharedKey: 'FAR', peerName: 'Bo' })
    const imported = await api(B, 'POST', '/api/shares/import', { fragment: share.link.split('#')[1], peerName: 'Ana' })

    const res = await fetch(`${B.url}/api/projects/${imported.project.id}/pull`, { method: 'POST' })
    const body = await res.text()
    expect(res.status).toBe(503)
    expect(body).toContain('no signaling relay configured')
    expect(body).toContain('wizard')
    // And the instance is still alive and honest afterwards.
    const status = await api(B, 'GET', '/api/sync/relay')
    expect(status.configured).toBe(false)
  })
})
