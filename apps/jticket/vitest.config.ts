import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { configDefaults, defineConfig } from 'vitest/config'

// Unit-level tests: fast, in-process — the server's pure logic (server/utils),
// the harness tests under tests/, and the peer-manager suites under test/
// (peer manager + local relay live in the test process). Nothing here boots
// Nuxt. The two-instance harness runs under vitest.e2e.config.ts.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'test/**/*.test.ts', 'server/**/*.test.ts'],
    // ownership.test.ts is a node:test file (run with `node --test`), not a
    // vitest suite; *.e2e.test.ts belong to the e2e config.
    exclude: [
      ...configDefaults.exclude,
      'server/utils/ownership.test.ts',
      'test/**/*.e2e.test.ts',
    ],
    environment: 'node',
    testTimeout: 20_000,
    hookTimeout: 20_000,
    // Store modules resolve .data through @jsuite/data at import time, so every
    // test runs against a throwaway data root instead of the real .data/. The
    // setup file re-scopes it per worker so parallel test files never share a
    // root (TICK-305); this env value is the fallback for anything reading it
    // outside a worker.
    env: { JSUITE_DATA_DIR: join(tmpdir(), 'jticket-vitest-data') },
    setupFiles: ['tests/setup/per-worker-data-dir.ts'],
  },
})
