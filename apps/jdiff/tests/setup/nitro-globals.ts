import { join } from 'node:path'
import { tmpdir } from 'node:os'

// Scope the data root per vitest worker BEFORE any store module loads —
// @jsuite/data resolves the root at import time (same pattern as jticket).
process.env.JSUITE_DATA_DIR = join(
  tmpdir(),
  'jdiff-vitest-data',
  `w${process.env.VITEST_POOL_ID ?? '0'}`,
)

// The server modules under test run inside Nitro in production, where these
// names are auto-imported. Wire the same names as globals for the tests.
;(globalThis as any).createError = (opts: any) => {
  const err = new Error(opts?.message ?? 'error') as any
  err.statusCode = opts?.statusCode
  return err
}

const failureStore = await import('../../server/utils/failureStore')
const tourStore = await import('../../server/utils/tourStore')
Object.assign(globalThis, {
  appendFailures: failureStore.appendFailures,
  clearFailures: failureStore.clearFailures,
  deleteChainTours: tourStore.deleteChainTours,
})
