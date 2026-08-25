import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startInstance, type Instance } from './harness/instance'

// TICK-298: the wizard-written .data/jticket/sync.json is enough on its own —
// no env var — and a machine with no relay configured at all degrades to clear
// errors, never a crash.
//
// A boots with the config file only (every env override explicitly blank,
// which syncRelayConfig() must treat as unset); B boots with nothing. Neither
// instance is expected to reach Supabase: what is under test is the config
// path, and the credentials below are deliberately fictitious.

let A: Instance // relay wired via sync.json — the wizard's output
let B: Instance // no relay configured at all

const SUPABASE_URL = 'https://config-test.supabase.co'
const SUPABASE_KEY = 'sb_publishable_configtest'

const blankEnv = { JTICKET_SYNC_RELAY_URL: '', JTICKET_SUPABASE_URL: '', JTICKET_SUPABASE_KEY: '' }

beforeAll(async () => {
  ;[A, B] = await Promise.all([
    startInstance({ label: 'cfg', env: { ...blankEnv, JTICKET_SYNC_TICK_MS: '200' } }),
    startInstance({ label: 'bare', env: blankEnv }),
  ])
  mkdirSync(join(A.dataDir, 'jticket'), { recursive: true })
  writeFileSync(
    join(A.dataDir, 'jticket', 'sync.json'),
    JSON.stringify({ supabaseUrl: SUPABASE_URL, supabaseKey: SUPABASE_KEY }),
  )
})

afterAll(async () => {
  await Promise.all([A?.dispose(), B?.dispose()])
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
    // The file was written after boot; sync.json is read fresh on every call
    // precisely so a wizard run lands on a running app.
    const status = await api(A, 'GET', '/api/sync/relay')
    expect(status).toEqual({ configured: true, provider: 'supabase', url: SUPABASE_URL })
  })

  it('never reports the key back — the URL is local config, the key is not', async () => {
    const status = await api(A, 'GET', '/api/sync/relay')
    expect(JSON.stringify(status)).not.toContain(SUPABASE_KEY)
  })

  it('a real share arms without the relay having to be reachable', async () => {
    // There is no room to register any more: a room is a broadcast topic named
    // by its id, so a share is usable the moment it is cut. That the fictitious
    // project above is unreachable must not stop the link being minted.
    const project = await api(A, 'POST', '/api/projects', { title: 'Wizard-wired' })
    const { share } = await api(A, 'POST', `/api/projects/${project.id}/share`, { sharedKey: 'WIZ', peerName: 'Bo' })
    expect(share.link).toContain('#')
    expect(share.status).toBe('active')
    // …and the instance is still healthy with an unreachable relay configured.
    expect((await api(A, 'GET', '/api/sync/relay')).configured).toBe(true)
  })
})

describe('no relay configured anywhere', () => {
  it('says so', async () => {
    const status = await api(B, 'GET', '/api/sync/relay')
    expect(status).toEqual({ configured: false, provider: null, url: '' })
  })

  it('a pull refuses with a clear 503 naming the wizard — no crash', async () => {
    // B imports A's share so it holds the pulling (importer) side.
    const project = await api(A, 'POST', '/api/projects', { title: 'Unreachable' })
    const { share } = await api(A, 'POST', `/api/projects/${project.id}/share`, { sharedKey: 'FAR', peerName: 'Bo' })
    const imported = await api(B, 'POST', '/api/shares/import', { fragment: share.link.split('#')[1], peerName: 'Ana' })

    const res = await fetch(`${B.url}/api/projects/${imported.project.id}/pull`, { method: 'POST' })
    const body = await res.text()
    expect(res.status).toBe(503)
    expect(body).toContain('no sync relay configured')
    expect(body).toContain('wizard')
    // And the instance is still alive and honest afterwards.
    const status = await api(B, 'GET', '/api/sync/relay')
    expect(status.configured).toBe(false)
  })
})
