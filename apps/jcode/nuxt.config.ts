import { fileURLToPath } from 'node:url'

export default defineNuxtConfig({
  compatibilityDate: '2025-07-01',
  runtimeConfig: {
    // Absolute path of the console preload the run stream injects into node
    // runners (NODE_OPTIONS=--import) so the human's console.logs are tagged.
    jcodePreload: fileURLToPath(new URL('./preload/jcode-console.mjs', import.meta.url)),
    // Per-language sandbox runners, copied into each kata's sandbox on publish.
    jcodeRunners: fileURLToPath(new URL('./runners', import.meta.url)),
    // The app's own tsx binary — sandboxes run TypeScript with no node_modules of their own.
    jcodeTsx: fileURLToPath(new URL('./node_modules/.bin/tsx', import.meta.url)),
  },
  // The shared document system (which itself extends @jsuite/charting) — the
  // Block* renderers for briefs/hints/answers, useMarkdown/useShiki, and
  // /api/documents + /api/charts over the suite-wide pools.
  extends: ['@jsuite/documents'],
  modules: ['@nuxt/ui'],
  css: ['~/assets/css/main.css'],
  devtools: { enabled: false },
  app: {
    head: {
      title: 'jCode',
      meta: [{ name: 'description', content: 'Hand-code the part that matters — brief, hints, answer, one rung at a time' }],
      link: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
    },
  },
  ui: { colorMode: true },
  // Served behind the jSuite Caddy edge at https://jcode.local — allow that
  // host through Vite's dev-server host check.
  vite: {
    server: { allowedHosts: ['jcode.local'] },
  },
})
