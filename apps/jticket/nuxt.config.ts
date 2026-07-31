// jTicket — lean local task tracker. https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-01',
  // The documents layer brings the shared block-document system (renderers,
  // <DocumentArticle>, /api/documents over .data/jexplain/) plus, transitively,
  // @jsuite/charting — docs here are the same objects jExplain renders.
  extends: ['@jsuite/documents'],
  modules: ['@nuxt/ui'],
  css: ['~/assets/css/main.css'],
  devtools: { enabled: true },
  // Pages set a bare page title ('Board', 'DOC-3 — Rollout plan'); app.vue's
  // titleTemplate suffixes ' · jTicket'.
  app: {
    head: {
      title: 'jTicket',
      meta: [{ name: 'description', content: 'Local epics + tickets tracker' }],
      link: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
    },
  },
  ui: {
    // Slate/indigo, dashboard-functional not flashy.
    colorMode: true,
  },
  // Served behind the jSuite Caddy edge at https://jticket.local — allow that
  // host through Vite's dev-server host check (localhost access is unaffected).
  vite: {
    server: { allowedHosts: ['jticket.local'] },
  },
})
