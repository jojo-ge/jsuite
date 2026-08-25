// Drive the sync server's presence loop: while shares this machine created
// are active, a waiting dial sits in each share's relay room so an importer's
// pull can reach us whenever the app is up (spec DOC-30 — no browser tab
// involved). No relay configured = the loop never starts and sync stays off.
//
// The sync server is imported lazily, per tick: its chain ends at
// node-datachannel's native addon, which resolves through the workspace's
// pnpm layout but not from a bare `node .output/server/index.mjs` — a boot
// must never die on it, and route handlers are already lazy.
export default defineNitroPlugin(() => {
  if (!syncRelayUrl()) return
  const timer = setInterval(() => {
    void import('../utils/syncServe')
      .then(({ useSyncServer }) => useSyncServer().tick())
      .catch(() => {})
  }, syncTickMs())
  timer.unref?.()
})
