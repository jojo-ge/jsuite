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
  const child: ChildProcess = spawn('node', [serverEntry], {
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      JSUITE_DATA_DIR: dataDir,
      ...env,
    },
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
