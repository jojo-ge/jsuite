import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// The setup wizard (wizard.sh) is a human-driven script, so these checks run
// it non-interactively: scripted answers on stdin, a fake Supabase project
// standing in for the real one, and stubbed browser openers. What must hold:
// the wizard lands the project's URL and publishable key in
// <data>/jticket/sync.json exactly where jTicket reads them, verifies the
// project really relays before wiring it, and refuses clearly when it doesn't.

const relayDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const wizardPath = join(relayDir, 'wizard.sh')

const GOOD_KEY = 'sb_publishable_testkey'

let supabase // the fake project
let supabaseUrl

/**
 * A stand-in for Supabase's Realtime REST broadcast endpoint — the one the
 * wizard's verify step probes. Answers 202 for the right key, 401 otherwise,
 * and 404 anywhere else, so the wizard's three branches are all reachable.
 */
function startFakeSupabase() {
  const server = createServer((req, res) => {
    if (req.url !== '/realtime/v1/api/broadcast' || req.method !== 'POST') {
      res.writeHead(404).end('not found')
      return
    }
    if (req.headers.apikey !== GOOD_KEY) {
      res.writeHead(401).end(JSON.stringify({ message: 'Invalid API key' }))
      return
    }
    req.resume()
    req.on('end', () => res.writeHead(202).end(JSON.stringify({ message: 'ok' })))
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      resolve({ server, url: `http://127.0.0.1:${port}` })
    })
  })
}

beforeAll(async () => {
  const started = await startFakeSupabase()
  supabase = started.server
  supabaseUrl = started.url
})

afterAll(async () => {
  await new Promise((resolve) => supabase?.close(resolve))
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

/** A PATH dir shadowing the browser openers, so no test opens a real tab. */
function makeStubDir(dir) {
  mkdirSync(dir, { recursive: true })
  for (const opener of ['open', 'xdg-open']) {
    writeFileSync(join(dir, opener), '#!/usr/bin/env bash\nexit 0\n')
    chmodSync(join(dir, opener), 0o755)
  }
}

const syncConfig = (dataDir) => JSON.parse(readFileSync(join(dataDir, 'jticket', 'sync.json'), 'utf8'))

/** Run in a throwaway data dir; the callback gets its path. */
async function inDataDir(label, fn) {
  const dataDir = mkdtempSync(join(tmpdir(), `relay-wizard-${label}-`))
  const stubDir = mkdtempSync(join(tmpdir(), `relay-wizard-stub-${label}-`))
  makeStubDir(stubDir)
  try {
    return await fn(dataDir, stubDir)
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
    rmSync(stubDir, { recursive: true, force: true })
  }
}

describe('wizard.sh', () => {
  it('parses (bash -n)', async () => {
    const { code } = await new Promise((resolve) => {
      const child = spawn('bash', ['-n', wizardPath])
      child.on('close', (c) => resolve({ code: c }))
    })
    expect(code).toBe(0)
  })

  it('join path: wires an existing project into sync.json', async () => {
    await inDataDir('join', async (dataDir, stubDir) => {
      // Enter (start) → 2 (wire existing) → URL (trailing slash on purpose —
      // the wizard must normalize it) → publishable key.
      const { code, output } = await runWizard({
        input: `\n2\n${supabaseUrl}/\n${GOOD_KEY}\n`,
        dataDir,
        stubDir,
      })
      expect(output).toContain('Setup complete')
      expect(code).toBe(0)
      expect(syncConfig(dataDir)).toMatchObject({ supabaseUrl, supabaseKey: GOOD_KEY })
    })
  })

  it('create path: walks the dashboard, verifies, wires', async () => {
    await inDataDir('create', async (dataDir, stubDir) => {
      // Enter (start) → 1 (create) → Enter (project provisioned) → URL → key.
      const { code, output } = await runWizard({
        input: `\n1\n\n${supabaseUrl}\n${GOOD_KEY}\n`,
        dataDir,
        stubDir,
      })
      expect(output).toContain('Supabase relayed the probe')
      expect(output).toContain('Setup complete')
      expect(code).toBe(0)
      expect(syncConfig(dataDir)).toMatchObject({ supabaseUrl, supabaseKey: GOOD_KEY })
    })
  })

  it('refuses clearly when the project does not answer, and wires nothing', async () => {
    await inDataDir('dead', async (dataDir, stubDir) => {
      // Enter → 2 → a dead URL → a key → n (don't wire it anyway).
      const { code, output } = await runWizard({
        input: `\n2\nhttp://127.0.0.1:1\n${GOOD_KEY}\nn\n`,
        dataDir,
        stubDir,
      })
      expect(code).not.toBe(0)
      expect(output.toLowerCase()).toContain('probe did not succeed')
      expect(existsSync(join(dataDir, 'jticket', 'sync.json'))).toBe(false)
    })
  })

  it('names the wrong-key case instead of reporting a generic failure', async () => {
    await inDataDir('badkey', async (dataDir, stubDir) => {
      const { code, output } = await runWizard({
        input: `\n2\n${supabaseUrl}\nsb_secret_wrong\nn\n`,
        dataDir,
        stubDir,
      })
      expect(code).not.toBe(0)
      expect(output).toContain('rejected the key')
      expect(output).toContain('publishable/anon key')
      expect(existsSync(join(dataDir, 'jticket', 'sync.json'))).toBe(false)
    })
  })

  it('preserves unrelated keys already in sync.json, and clears the retired relayUrl', async () => {
    await inDataDir('merge', async (dataDir, stubDir) => {
      mkdirSync(join(dataDir, 'jticket'), { recursive: true })
      writeFileSync(
        join(dataDir, 'jticket', 'sync.json'),
        JSON.stringify({ relayUrl: 'https://old.workers.dev', future: true }),
      )
      const { code } = await runWizard({ input: `\n2\n${supabaseUrl}\n${GOOD_KEY}\n`, dataDir, stubDir })
      expect(code).toBe(0)
      const config = syncConfig(dataDir)
      expect(config).toMatchObject({ supabaseUrl, supabaseKey: GOOD_KEY, future: true })
      // The Cloudflare worker's URL is gone — leaving it would only mislead
      // the next reader.
      expect(config.relayUrl).toBeUndefined()
    })
  })
})
