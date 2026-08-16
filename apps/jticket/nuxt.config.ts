// jTicket — lean local task tracker. https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-01',
  // The documents layer brings the shared block-document system (renderers,
  // <DocumentArticle>, /api/documents over .data/jexplain/) plus, transitively,
  // @jsuite/charting — docs here are the same objects jExplain renders.
  //
  // The diff layer brings the whole review product — the engine (/api/diff,
  // /api/prs, the claude analysis runs, the artifact stores over .data/jdiff/)
  // and the review screens, served here at /diffs/… — so a PR is reviewed
  // inside jTicket rather than over in jDiff. `diff.basePath` keeps the layer's
  // namespaced default; never hardcode a review path, use useDiffRoutes().
  extends: ['@jsuite/documents', '@jsuite/diff'],
  modules: ['@nuxt/ui'],
  css: ['~/assets/css/main.css'],
  devtools: { enabled: true },
  // /docs was jTicket's own docs area back when a document had a DOC-n wrapper
  // record in front of it. The wrappers are gone (TICK-138) and the pool's own
  // library serves the same content at /documents, so the old paths redirect
  // rather than 404: `/docs/<key>` links are written into stored markdown, into
  // ticket resolutions, and into the skills' output going back months.
  routeRules: {
    '/docs': { redirect: { to: '/documents', statusCode: 301 } },
    '/docs/**': { redirect: { to: '/documents/**', statusCode: 301 } },
  },
  // Pages set a bare page title ('Board', 'Rollout plan'); app.vue's
  // titleTemplate suffixes ' · jTicket'.
  app: {
    head: {
      title: 'jTicket',
      meta: [{ name: 'description', content: 'Local projects + tickets tracker' }],
      link: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
    },
  },
  ui: {
    // Dashboard-functional, not flashy. The palette itself is periwinkle on
    // slate and lives in app/app.config.ts — app.config.ts resolves against
    // srcDir, so a copy at the app root would be dead (TICK-194).
    colorMode: true,
  },
  // Served behind the jSuite Caddy edge at https://jticket.local — allow that
  // host through Vite's dev-server host check (localhost access is unaffected).
  vite: {
    server: { allowedHosts: ['jticket.local'] },
  },
})
