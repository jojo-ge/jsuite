// jChart — annotatable, editable diagram workbench.
// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-01',
  // The Excalidraw canvas, Mermaid conversion, and scene utils come from the
  // shared charting layer (packages/charting).
  extends: ['@jsuite/charting'],
  modules: ['@nuxt/ui'],
  css: ['~/assets/css/main.css'],
  devtools: { enabled: false },
  app: {
    head: {
      title: 'jChart',
      meta: [{ name: 'description', content: 'Editable, annotatable diagrams' }],
      link: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
    },
  },
  ui: {
    colorMode: true,
  },
  // Served behind the jSuite Caddy edge at https://jchart.local — allow that
  // host through Vite's dev-server host check (localhost access is unaffected).
  // (The Excalidraw-specific vite defines/optimizeDeps come from the layer.)
  vite: {
    server: { allowedHosts: ['jchart.local'] },
  },
})
