// Drive the sync server's presence loop: while shares this machine created are
// active, it stays joined to each share's relay channel so an importer's pull
// can reach us whenever the app is up (spec DOC-30 — no browser tab involved).
// No relay configured = the loop never starts and sync stays off.
export default defineNitroPlugin(() => {
  if (!syncConfigured()) return
  const timer = setInterval(() => {
    void useSyncServer().tick().catch(() => {})
  }, syncTickMs())
  timer.unref?.()
})
