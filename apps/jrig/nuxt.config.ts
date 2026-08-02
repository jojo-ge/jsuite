export default defineNuxtConfig({
  compatibilityDate: '2025-07-01',
  modules: ['@nuxt/ui'],
  css: ['~/assets/css/main.css'],
  devtools: { enabled: false },
  app: {
    head: {
      title: 'jRig',
      meta: [{ name: 'description', content: 'Draw, rig and keyframe 2D avatar characters over one shared skeleton' }],
      link: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
    },
  },
  ui: { colorMode: true },
  // Served behind the jSuite Caddy edge at https://jrig.local — allow
  // that host through Vite's dev-server host check.
  vite: {
    server: { allowedHosts: ['jrig.local'] },
  },
})
