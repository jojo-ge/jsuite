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
  // jRig extends no shared layer, so it doesn't inherit @jsuite/charting's icon
  // config. Its pages use lucide icons via dynamic <UIcon> bindings, which @nuxt/icon
  // can't statically bundle — at SSR they render as empty placeholders, then load +
  // fill on the client (hydration mismatch + `[Icon] failed to load` warns). Scanning
  // the source bundles them so they resolve synchronously on both sides.
  icon: {
    clientBundle: { scan: true },
  },
  // Served behind the jSuite Caddy edge at https://jrig.local — allow
  // that host through Vite's dev-server host check.
  vite: {
    server: { allowedHosts: ['jrig.local'] },
  },
})
