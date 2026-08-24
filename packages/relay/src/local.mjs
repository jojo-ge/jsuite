import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Miniflare } from 'miniflare'

const workerPath = fileURLToPath(new URL('./worker.mjs', import.meta.url))
// Anchor module resolution to the worker's own directory — without this,
// workerd resolves the path relative to the caller's cwd and refuses to walk
// out of it, so startLocalRelay() only worked when run from packages/relay.
const workerRoot = dirname(workerPath)

/**
 * Run the relay worker locally on workerd (via Miniflare) — no Cloudflare
 * account involved. Used by the relay's own tests and by the two-instance
 * sync harness.
 *
 * @param {{ port?: number }} [options] port 0 (default) picks a free port
 * @returns {Promise<{ url: URL, dispose: () => Promise<void> }>}
 */
export async function startLocalRelay({ port = 0 } = {}) {
  const mf = new Miniflare({
    modulesRoot: workerRoot,
    // Miniflare takes an explicit module list — every file the worker imports
    // must appear here (wrangler bundles these itself on a real deploy).
    modules: [
      { type: 'ESModule', path: workerPath },
      { type: 'ESModule', path: join(workerRoot, 'closeCodes.mjs') },
    ],
    durableObjects: { ROOMS: 'RelayRoom' },
    compatibilityDate: '2026-08-01',
    port,
  })
  const url = await mf.ready
  return {
    url,
    dispose: () => mf.dispose(),
  }
}
