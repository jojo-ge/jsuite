import { defineConfig } from 'vitest/config'

// The two-instance harness: builds jTicket once (global setup), then each test
// spawns real server processes. Long timeouts because a nuxt build is involved.
export default defineConfig({
  test: {
    include: ['test/**/*.e2e.test.ts'],
    globalSetup: ['test/harness/global-setup.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
})
