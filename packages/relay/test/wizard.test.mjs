import { spawn } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startLocalRelay } from '../src/local.mjs'

// The deploy wizard (wizard.sh) is a human-driven script, so these checks run
// it non-interactively: scripted answers on stdin, the real relay worker on
// local workerd standing in for the deployed one, and a stubbed `wrangler`
// for the Cloudflare-only stages. What must hold: the wizard lands the relay
// URL in <data>/jticket/sync.json exactly where jTicket reads it, verifies
// the relay actually answers before wiring it, and refuses clearly when it
// does not.

const relayDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const wizardPath = join(relayDir, 'wizard.sh')

let relay

beforeAll(async () => {
  relay = await startLocalRelay()
})

afterAll(async () => {
  await relay?.dispose()
})

/** Run the wizard with scripted stdin; resolves { code, output }. */
function runWizard({ input, dataDir, stubDir }) {
  return new Promise((resolve, reject) => {
    const child = spawn('bash', [wizardPath], {
      cwd: relayDir,
      env: {
        ...process.env,
        PATH: stubDir ? `${stubDir}:${process.env.PATH}` : process.env.PATH,
        JSUITE_DATA_DIR: dataDir,
        // Point "is jTicket live?" somewhere that refuses instantly — the
        // machine's real jTicket must stay untouched by a test run.
        JTICKET_URL: 'http://127.0.0.1:1',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let output = ''
    child.stdout.on('data', (c) => (output += c))
    child.stderr.on('data', (c) => (output += c))
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, output }))
    child.stdin.write(input)
    child.stdin.end()
  })
}

/** A PATH dir shadowing `wrangler` (records calls, fakes deploy) and browser openers. */
function makeStubDir(dir, { deployUrl }) {
  mkdirSync(dir, { recursive: true })
  const log = join(dir, 'calls.log')
  writeFileSync(
    join(dir, 'wrangler'),
    [
      '#!/usr/bin/env bash',
      `echo "$PWD :: $*" >> "${log}"`,
      'case "$1" in',
      '  whoami) echo "you@example.com (stub)";;',
      `  deploy) echo "Uploaded jsuite-relay"; echo "  ${deployUrl}";;`,
      'esac',
    ].join('\n'),
  )
  for (const opener of ['open', 'xdg-open']) {
    writeFileSync(join(dir, opener), '#!/usr/bin/env bash\nexit 0\n')
  }
  for (const f of ['wrangler', 'open', 'xdg-open']) chmodSync(join(dir, f), 0o755)
  return { log }
}

// The URL as the wizard writes it — trailing slash stripped.
const relayBase = () => relay.url.href.replace(/\/$/, '')

const syncConfig = (dataDir) => JSON.parse(readFileSync(join(dataDir, 'jticket', 'sync.json'), 'utf8'))

describe('wizard.sh', () => {
  it('parses (bash -n)', async () => {
    const { code } = await new Promise((resolve) => {
      const child = spawn('bash', ['-n', wizardPath])
      child.on('close', (c) => resolve({ code: c }))
    })
    expect(code).toBe(0)
  })

  it('join path: wires an existing relay URL into sync.json', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'relay-wizard-join-'))
    try {
      // Enter (start) → 2 (wire existing) → the relay URL (trailing slash on
      // purpose — the wizard must normalize it).
      const { code, output } = await runWizard({
        input: `\n2\n${relay.url.href}\n`,
        dataDir,
      })
      expect(output).toContain('Setup complete')
      expect(code).toBe(0)
      expect(syncConfig(dataDir).relayUrl).toBe(relayBase())
    } finally {
      rmSync(dataDir, { recursive: true, force: true })
    }
  })

  it('deploy path: deploys via wrangler from the relay dir, verifies, wires', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'relay-wizard-deploy-'))
    const stubDir = mkdtempSync(join(tmpdir(), 'relay-wizard-stub-'))
    const { log } = makeStubDir(stubDir, { deployUrl: 'https://jsuite-relay.stub-account.workers.dev' })
    try {
      // Enter (start) → 1 (deploy) → Enter (signed in to Cloudflare) → paste
      // the "deployed" URL, overriding the detected stub one with the live
      // local relay so the verify probe is real.
      const { code, output } = await runWizard({
        input: `\n1\n\n${relay.url.href}\n`,
        dataDir,
        stubDir,
      })
      expect(output).toContain('jsuite-relay.stub-account.workers.dev') // detected from deploy output
      expect(output).toContain('Setup complete')
      expect(code).toBe(0)
      const calls = readFileSync(log, 'utf8')
      expect(calls).toContain(':: whoami')
      expect(calls).toMatch(/packages\/relay :: deploy/) // deploy runs where wrangler.jsonc lives
      expect(syncConfig(dataDir).relayUrl).toBe(relayBase())
    } finally {
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(stubDir, { recursive: true, force: true })
    }
  })

  it('refuses clearly when the relay does not answer, and wires nothing', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'relay-wizard-bad-'))
    try {
      // Enter → 2 → a dead URL → n (don't wire it anyway).
      const { code, output } = await runWizard({
        input: '\n2\nhttp://127.0.0.1:1\nn\n',
        dataDir,
      })
      expect(code).not.toBe(0)
      expect(output.toLowerCase()).toContain('relay')
      expect(existsSync(join(dataDir, 'jticket', 'sync.json'))).toBe(false)
    } finally {
      rmSync(dataDir, { recursive: true, force: true })
    }
  })

  it('preserves unrelated keys already in sync.json', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'relay-wizard-merge-'))
    try {
      mkdirSync(join(dataDir, 'jticket'), { recursive: true })
      writeFileSync(join(dataDir, 'jticket', 'sync.json'), JSON.stringify({ relayUrl: 'https://old.example', future: true }))
      const { code } = await runWizard({ input: `\n2\n${relay.url.href}\n`, dataDir })
      expect(code).toBe(0)
      const config = syncConfig(dataDir)
      expect(config.relayUrl).toBe(relayBase())
      expect(config.future).toBe(true)
    } finally {
      rmSync(dataDir, { recursive: true, force: true })
    }
  })
})
