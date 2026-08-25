import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { syncConfigured, syncRelayConfig } from './syncConfig'

// The relay config resolves env-first (the harness boots instances with
// per-process env), then the wizard-written .data/jticket/sync.json, then
// null. Each test gets its own data root so the shared vitest data dir stays
// out of the picture.

describe('syncRelayConfig', () => {
  let dataDir: string
  const savedEnv: Record<string, string | undefined> = {}
  const ENV_KEYS = ['JSUITE_DATA_DIR', 'JTICKET_SYNC_RELAY_URL', 'JTICKET_SUPABASE_URL', 'JTICKET_SUPABASE_KEY']

  const writeConfig = (content: string) => {
    mkdirSync(join(dataDir, 'jticket'), { recursive: true })
    writeFileSync(join(dataDir, 'jticket', 'sync.json'), content)
  }

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'jticket-sync-config-'))
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key]
      delete process.env[key]
    }
    process.env.JSUITE_DATA_DIR = dataDir
  })

  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    rmSync(dataDir, { recursive: true, force: true })
  })

  it('is null when neither env nor config file exist', () => {
    expect(syncRelayConfig()).toBeNull()
    expect(syncConfigured()).toBe(false)
  })

  it('reads the wizard-written sync.json', () => {
    writeConfig(JSON.stringify({ supabaseUrl: 'https://abc.supabase.co', supabaseKey: 'sb_publishable_xyz' }))
    expect(syncRelayConfig()).toEqual({ kind: 'supabase', url: 'https://abc.supabase.co', key: 'sb_publishable_xyz' })
  })

  it('lets the env override the file', () => {
    writeConfig(JSON.stringify({ supabaseUrl: 'https://file.supabase.co', supabaseKey: 'file-key' }))
    process.env.JTICKET_SUPABASE_URL = 'https://env.supabase.co'
    process.env.JTICKET_SUPABASE_KEY = 'env-key'
    expect(syncRelayConfig()).toEqual({ kind: 'supabase', url: 'https://env.supabase.co', key: 'env-key' })
  })

  it('takes the local relay ahead of everything — the harness boots instances that way', () => {
    writeConfig(JSON.stringify({ supabaseUrl: 'https://abc.supabase.co', supabaseKey: 'k' }))
    process.env.JTICKET_SYNC_RELAY_URL = 'ws://127.0.0.1:8787'
    expect(syncRelayConfig()).toEqual({ kind: 'local', url: 'ws://127.0.0.1:8787' })
  })

  it('treats an empty env value as unset, not as an override', () => {
    writeConfig(JSON.stringify({ supabaseUrl: 'https://file.supabase.co', supabaseKey: 'file-key' }))
    process.env.JTICKET_SUPABASE_URL = '   '
    process.env.JTICKET_SYNC_RELAY_URL = '  '
    expect(syncRelayConfig()).toEqual({ kind: 'supabase', url: 'https://file.supabase.co', key: 'file-key' })
  })

  it('reads fresh on every call — a wizard run lands without a restart', () => {
    expect(syncRelayConfig()).toBeNull()
    writeConfig(JSON.stringify({ supabaseUrl: 'https://late.supabase.co', supabaseKey: 'k' }))
    expect(syncRelayConfig()).toMatchObject({ url: 'https://late.supabase.co' })
  })

  it('reads a sync.json holding only the retired Cloudflare relayUrl as unconfigured', () => {
    // That URL points at a signaling-only worker the current transport cannot
    // speak to at all. Honest "unconfigured" beats a pull that dials a dead
    // relay and times out; the wizard rewrites the file.
    writeConfig(JSON.stringify({ relayUrl: 'https://jsuite-relay.example.workers.dev' }))
    expect(syncRelayConfig()).toBeNull()
  })

  it.each([
    ['malformed JSON', 'not json {'],
    ['missing fields', JSON.stringify({ other: true })],
    ['url without a key', JSON.stringify({ supabaseUrl: 'https://abc.supabase.co' })],
    ['key without a url', JSON.stringify({ supabaseKey: 'k' })],
    ['non-string fields', JSON.stringify({ supabaseUrl: 42, supabaseKey: 7 })],
    ['blank fields', JSON.stringify({ supabaseUrl: '   ', supabaseKey: '  ' })],
  ])('falls back to unconfigured on %s — never throws', (_name, content) => {
    writeConfig(content)
    expect(syncRelayConfig()).toBeNull()
  })
})
