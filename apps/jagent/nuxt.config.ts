export default defineNuxtConfig({
  compatibilityDate: '2025-07-01',
  // The shared diff pipeline — rawWorktreeDiff/buildDiff/highlightLines are
  // auto-imported into this app's Nitro context from the layer's server/utils.
  extends: ['@jsuite/diff'],
  modules: ['@nuxt/ui'],
  css: ['~/assets/css/main.css'],
  devtools: { enabled: false },
  ssr: false,
  app: {
    head: {
      title: 'jAgent',
      meta: [{ name: 'description', content: 'Dispatch and watch a fleet of ticket agents' }],
      link: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
    },
  },
  ui: { colorMode: true },
  // Layers contribute no components here, but @nuxt/ui needs icon scanning on.
  icon: { clientBundle: { scan: true } },
  // Served behind the jSuite Caddy edge at https://jagent.local — allow that
  // host through Vite's dev-server host check.
  vite: {
    server: { allowedHosts: ['jagent.local'] },
  },
})
