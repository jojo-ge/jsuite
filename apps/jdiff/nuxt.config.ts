// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  // The whole review engine — target resolution, the diff/graph/file/PR routes,
  // the claude analysis runs and every artifact store — lives in @jsuite/diff,
  // along with the review vocabulary the UI shares with it (risk, tour, ask
  // questions, file categories). What's left here is the jDiff shell: the pages,
  // the components and the scratch prototypes.
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
