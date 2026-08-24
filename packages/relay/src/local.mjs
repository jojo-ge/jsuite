import { fileURLToPath } from 'node:url'
import { Miniflare } from 'miniflare'

const workerPath = fileURLToPath(new URL('./worker.mjs', import.meta.url))

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
    modules: [{ type: 'ESModule', path: workerPath }],
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
