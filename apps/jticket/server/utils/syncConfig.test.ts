import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { syncRelayUrl } from './syncConfig'

// The relay URL resolves env-first (the harness boots instances with
// per-process env), then the wizard-written .data/jticket/sync.json, then ''.
// Each test gets its own data root so the shared vitest data dir stays out of
// the picture.

describe('syncRelayUrl', () => {
  let dataDir: string
  const savedEnv: Record<string, string | undefined> = {}

  const writeConfig = (content: string) => {
    mkdirSync(join(dataDir, 'jticket'), { recursive: true })
    writeFileSync(join(dataDir, 'jticket', 'sync.json'), content)
  }

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'jticket-sync-config-'))
    savedEnv.JSUITE_DATA_DIR = process.env.JSUITE_DATA_DIR
    savedEnv.JTICKET_RELAY_URL = process.env.JTICKET_RELAY_URL
    process.env.JSUITE_DATA_DIR = dataDir
    delete process.env.JTICKET_RELAY_URL
  })

  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    rmSync(dataDir, { recursive: true, force: true })
  })

  it('is empty when neither env nor config file exist', () => {
    expect(syncRelayUrl()).toBe('')
  })

  it('reads the wizard-written sync.json', () => {
    writeConfig(JSON.stringify({ relayUrl: 'https://jsuite-relay.example.workers.dev' }))
    expect(syncRelayUrl()).toBe('https://jsuite-relay.example.workers.dev')
  })

  it('lets the env override the file — the harness boots instances that way', () => {
    writeConfig(JSON.stringify({ relayUrl: 'https://file.example' }))
    process.env.JTICKET_RELAY_URL = 'http://127.0.0.1:8787'
    expect(syncRelayUrl()).toBe('http://127.0.0.1:8787')
  })

  it('treats an empty env value as unset, not as an override', () => {
    writeConfig(JSON.stringify({ relayUrl: 'https://file.example' }))
    process.env.JTICKET_RELAY_URL = '   '
    expect(syncRelayUrl()).toBe('https://file.example')
  })

  it('reads fresh on every call — a wizard run lands without a restart', () => {
    expect(syncRelayUrl()).toBe('')
    writeConfig(JSON.stringify({ relayUrl: 'https://late.example' }))
    expect(syncRelayUrl()).toBe('https://late.example')
  })

  it.each([
    ['malformed JSON', 'not json {'],
    ['missing field', JSON.stringify({ other: true })],
    ['non-string field', JSON.stringify({ relayUrl: 42 })],
    ['blank field', JSON.stringify({ relayUrl: '   ' })],
  ])('falls back to unconfigured on %s — never throws', (_name, content) => {
    writeConfig(content)
    expect(syncRelayUrl()).toBe('')
  })
})
