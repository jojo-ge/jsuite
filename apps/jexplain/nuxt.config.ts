// jExplain — the reading shell for the shared block-document system.
// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-01',
  // The documents layer brings the whole document system — block renderers,
  // <DocumentArticle>, /api/documents over .data/jexplain/ — and extends
  // @jsuite/charting itself, so charts ride in with it: a chart embedded here
  // is the same object jChart opens, both reading .data/jchart/.
  extends: ['@jsuite/documents'],
  modules: ['@nuxt/ui'],
  css: ['~/assets/css/main.css'],
  devtools: { enabled: false },
  app: {
    head: {
      title: 'jExplain',
      meta: [{ name: 'description', content: 'Rich explainers, annotated and charted' }],
      link: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
    },
  },
  ui: {
    colorMode: true,
  },
  // Served behind the jSuite Caddy edge at https://jexplain.local:7443 — allow
  // that host through Vite's dev-server host check.
  vite: {
    server: { allowedHosts: ['jexplain.local'] },
  },
})
