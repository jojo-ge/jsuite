// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
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
  // Served behind the jSuite Caddy edge at https://jdiff.local:7443 — allow that
  // host through Vite's dev-server host check (localhost access is unaffected).
  vite: {
    server: { allowedHosts: ['jdiff.local'] },
  },
})
