// Whether a signaling relay is configured on this machine, and which one —
// the share panel warns off this, and the deploy wizard's verify step reads
// it back after writing .data/jticket/sync.json. The URL is local config
// (never secret), so returning it is fine.
export default defineEventHandler(() => {
  const relayUrl = syncRelayUrl()
  return { relayUrl, configured: !!relayUrl }
})
