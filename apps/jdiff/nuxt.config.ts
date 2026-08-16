// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  // The whole review product — the engine (target resolution, the diff/graph/
  // file/PR routes, the claude analysis runs, every artifact store) *and* the UI
  // (the review screens, their components and composables) — lives in
  // @jsuite/diff, which serves it at /diffs/… on any app that extends the layer.
  // What's left here is the jDiff shell: two-line pages aliasing those screens
  // onto jDiff's short routes (see app/app.config.ts), the CLI, and the scratch
  // prototypes.
  extends: ['@jsuite/diff'],
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  css: ['~/assets/css/main.css'],
  ssr: false,
  // Pages set a bare page title ('branches', 'PR #12 — …'); app.vue's
  // titleTemplate suffixes ' · jDiff'.
  app: {
    head: {
      title: 'jDiff',
      meta: [{ name: 'description', content: 'Review branches and PRs against your local checkout' }],
      link: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
    },
  },
  // Served behind the jSuite Caddy edge at https://jdiff.local — allow that
  // host through Vite's dev-server host check (localhost access is unaffected).
  vite: {
    server: { allowedHosts: ['jdiff.local'] },
  },
})
