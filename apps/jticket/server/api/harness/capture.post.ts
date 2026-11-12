// Run the harness capture now: freeze every finished session's digest and
// snapshot every ended run that has none (harnessCapture.ts). The auto-loop
// plugin does this every few minutes; this is the same pass on demand —
// idempotent, safe to re-run. Body: {} or { force: true } to rebuild every
// ended run's snapshot.
export default defineEventHandler(async (event) => {
  const body = (await readBody<{ force?: boolean }>(event).catch(() => ({}))) ?? {}
  return captureHarness(loadStore(), { force: body.force === true })
})
