import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { configDefaults, defineConfig } from 'vitest/config'

// Unit tests cover the server's pure logic (server/utils) and the harness
// tests under tests/; nothing here boots Nuxt. Run with `pnpm test` from
// apps/jticket.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'server/**/*.test.ts'],
    // ownership.test.ts is a node:test file (run with `node --test`), not a
    // vitest suite — keep it out of vitest's sweep.
    exclude: [...configDefaults.exclude, 'server/utils/ownership.test.ts'],
    environment: 'node',
    // Store modules resolve .data through @jsuite/data at import time, so every
    // test runs against a throwaway data root instead of the real .data/.
    env: { JSUITE_DATA_DIR: join(tmpdir(), 'jticket-vitest-data') },
  },
})
