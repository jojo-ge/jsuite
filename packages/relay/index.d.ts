export interface LocalRelay {
  /** Base URL of the locally-running relay (http://127.0.0.1:<port>/). */
  url: URL
  dispose(): Promise<void>
}

/**
 * Run the relay worker locally on workerd (via Miniflare) — no Cloudflare
 * account involved. Used by the relay's own tests and by the two-instance
 * sync harness.
 */
export function startLocalRelay(options?: { port?: number }): Promise<LocalRelay>
