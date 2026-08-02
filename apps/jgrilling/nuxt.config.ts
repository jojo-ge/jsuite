export default defineNuxtConfig({
  compatibilityDate: '2025-07-01',
  // The shared document system (which itself extends @jsuite/charting) — gives
  // this app <DocumentArticle>, the Block* renderers, /api/documents and
  // /api/charts over the suite-wide pools.
  extends: ['@jsuite/documents'],
  modules: ['@nuxt/ui'],
  css: ['~/assets/css/main.css'],
  devtools: { enabled: false },
  app: {
    head: {
      title: 'jGrilling',
      meta: [{ name: 'description', content: 'Get grilled about a plan before you build it' }],
      link: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
    },
  },
  ui: { colorMode: true },
  // Served behind the jSuite Caddy edge at https://jgrilling.local — allow
  // that host through Vite's dev-server host check.
  vite: {
    server: { allowedHosts: ['jgrilling.local'] },
  },
})
