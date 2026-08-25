import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// Build jTicket once for the whole e2e run — the harness boots instances from
// .output/server/index.mjs. Set JTICKET_E2E_SKIP_BUILD=1 to reuse a previous
// build while iterating on tests (server code changes DO need a rebuild).

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

export default function globalSetup() {
  const serverEntry = join(appDir, '.output', 'server', 'index.mjs')
  if (process.env.JTICKET_E2E_SKIP_BUILD === '1' && existsSync(serverEntry)) {
    console.log('[harness] reusing existing .output build (JTICKET_E2E_SKIP_BUILD=1)')
    return
  }
  console.log('[harness] building jTicket (nuxt build)…')
  const result = spawnSync('pnpm', ['exec', 'nuxt', 'build'], {
    cwd: appDir,
    stdio: 'inherit',
    env: { ...process.env },
  })
  if (result.status !== 0) throw new Error(`nuxt build failed with status ${result.status}`)
  if (!existsSync(serverEntry)) throw new Error(`build produced no server entry at ${serverEntry}`)
}
