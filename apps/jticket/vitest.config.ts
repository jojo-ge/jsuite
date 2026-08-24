import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Store modules resolve .data through @jsuite/data at import time, so every
    // test runs against a throwaway data root instead of the real .data/.
    env: { JSUITE_DATA_DIR: join(tmpdir(), 'jticket-vitest-data') },
  },
})
