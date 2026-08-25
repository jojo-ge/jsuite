// Whether a sync relay is configured on this machine, and which kind — the
// share panel warns off this, and the deploy wizard's verify step reads it
// back after writing .data/jticket/sync.json. The URL is local config (never
// secret) so returning it is fine; the key is NOT returned.
export default defineEventHandler(() => {
  const config = syncRelayConfig()
  if (!config) return { configured: false, provider: null, url: '' }
  return { configured: true, provider: config.kind, url: config.url }
})
