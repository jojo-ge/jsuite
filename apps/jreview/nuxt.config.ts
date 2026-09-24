export default defineNuxtConfig({
  compatibilityDate: '2025-07-01',
  // The shared document system (which itself extends @jsuite/charting) — gives
  // this app <DocumentArticle>, the Block* renderers, /api/documents and
  // /api/charts over the suite-wide pools. Reviewers and the triager publish
  // their reports into that pool; the review room renders them inline.
  extends: ['@jsuite/documents'],
  modules: ['@nuxt/ui'],
  css: ['~/assets/css/main.css'],
  devtools: { enabled: false },
  app: {
    head: {
      title: 'jReview',
      meta: [{ name: 'description', content: 'Four reviewers, one triage, tickets on your say-so' }],
      link: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
    },
  },
  ui: { colorMode: true },
  // Served behind the jSuite Caddy edge at https://jreview.local — allow
  // that host through Vite's dev-server host check.
  vite: {
    server: { allowedHosts: ['jreview.local'] },
  },
})
