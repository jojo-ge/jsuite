import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// Boot a real jTicket server process from the .output build, isolated behind
// its own temp JSUITE_DATA_DIR. This is the instance half of the two-instance
// harness; the relay half is @jsuite/relay's startLocalRelay().

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const serverEntry = join(appDir, '.output', 'server', 'index.mjs')

export interface Instance {
  /** Base URL, e.g. http://127.0.0.1:43121 */
  url: string
  dataDir: string
  dispose(): Promise<void>
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number }
      server.close(() => resolve(port))
    })
  })
}

export async function startInstance({
  label = 'jticket',
  env = {} as Record<string, string>,
} = {}): Promise<Instance> {
  const port = await freePort()
  const dataDir = mkdtempSync(join(tmpdir(), `jticket-harness-${label}-`))
  // pnpm run sets NODE_PATH to its hidden hoist dir, which would let the
  // node-datachannel platform addon resolve from the workspace store even when
  // the build didn't package it. Strip the inherited value so instances boot
  // exactly like a deployed `node .output/server/index.mjs` from a clean shell
  // (TICK-306); a test that passes its own NODE_PATH via `env` still wins.
  const childEnv: Record<string, string | undefined> = { ...process.env }
  delete childEnv.NODE_PATH
  Object.assign(childEnv, {
    PORT: String(port),
    HOST: '127.0.0.1',
    JSUITE_DATA_DIR: dataDir,
    // Both instances live on this host, so their ICE has no business on the
    // machine's real interfaces — binding loopback keeps self-connections off
    // the VPN subnets and rotating IPv6 privacy addresses that die mid-DTLS
    // with EADDRNOTAVAIL (TICK-300, TICK-308). Test-only: production leaves
    // JTICKET_ICE_BIND_ADDRESS unset. A test's own env still wins.
    JTICKET_ICE_BIND_ADDRESS: '127.0.0.1',
    ...env,
  })
  const child: ChildProcess = spawn('node', [serverEntry], {
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout?.on('data', (chunk) => (output += chunk))
  child.stderr?.on('data', (chunk) => (output += chunk))

  const url = `http://127.0.0.1:${port}`
  const deadline = Date.now() + 30_000
  for (;;) {
    if (child.exitCode !== null) {
      throw new Error(`[harness:${label}] server exited with ${child.exitCode}:\n${output}`)
    }
    try {
      const res = await fetch(`${url}/api/projects`)
      if (res.ok) break
    } catch {}
    if (Date.now() > deadline) {
      child.kill('SIGKILL')
      throw new Error(`[harness:${label}] server did not become healthy:\n${output}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  return {
    url,
    dataDir,
    async dispose() {
      child.kill('SIGTERM')
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          child.kill('SIGKILL')
          resolve()
        }, 3_000)
        child.once('exit', () => {
          clearTimeout(timer)
          resolve()
        })
      })
      rmSync(dataDir, { recursive: true, force: true })
    },
  }
}
