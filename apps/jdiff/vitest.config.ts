import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { defineConfig } from 'vitest/config'

// Unit-level tests: fast, in-process — the server's pure logic (validators,
// the dispatch registry, the JSON stores). Nothing here boots Nuxt; the
// Nitro auto-import globals the modules rely on (createError, cross-util
// store functions) are wired by the setup file.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Store modules resolve .data through @jsuite/data at import time; the
    // setup file re-scopes the root per worker so parallel test files never
    // share fixtures. This env value is the fallback outside a worker.
    env: { JSUITE_DATA_DIR: join(tmpdir(), 'jdiff-vitest-data') },
    setupFiles: ['tests/setup/nitro-globals.ts'],
  },
})
