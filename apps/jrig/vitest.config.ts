import { defineConfig } from 'vitest/config'

// The rig core is framework-free TS, so the ported specs run under plain
// vitest — no Nuxt test environment needed. Component specs (later milestones)
// opt into happy-dom per file via `// @vitest-environment happy-dom`.
export default defineConfig({
  test: {
    include: ['rig/**/*.spec.ts', 'studio/**/*.spec.ts'],
  },
})
