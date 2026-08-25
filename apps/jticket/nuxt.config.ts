// jTicket — lean local task tracker. https://nuxt.com/docs/api/configuration/nuxt-config
import { createRequire } from 'node:module'

// node-datachannel picks its platform addon (@node-datachannel/darwin-arm64,
// …) with a require() whose argument is computed at runtime, so nitro's file
// tracer never sees it and a bare `node .output/server/index.mjs` boots
// without WebRTC (sync degrades to 503). Resolve whichever addon packages are
// installed on this build host — from node-datachannel's own directory, since
// pnpm exposes its optionalDependencies only there — and hand nitro the
// absolute paths to trace into .output/server/node_modules.
const nodeDatachannelAddons = (() => {
  const require = createRequire(import.meta.url)
  const ndcRequire = createRequire(require.resolve('node-datachannel'))
  // Mirrors node-datachannel's optionalDependencies (its exports map blocks
  // reading its package.json directly) — recheck on upgrades.
  const platforms = [
    'android-arm64',
    'darwin-arm64',
    'darwin-x64',
    'linux-arm64-gnu',
    'linux-arm64-musl',
    'linux-x64-gnu',
    'linux-x64-musl',
    'win32-arm64-msvc',
    'win32-x64-msvc',
  ]
  const found = platforms.flatMap((p) => {
    try {
      return [ndcRequire.resolve(`@node-datachannel/${p}`)]
    } catch {
      return []
    }
  })
  // Zero addons (pruned store, --no-optional install) would otherwise build a
  // server that silently degrades sync to 503 — say so while there's a human
  // watching the build.
  if (found.length === 0) {
    console.warn(
      '[jticket] no @node-datachannel platform addon resolved — the built server will boot without WebRTC sync',
    )
  }
  return found
})()

export default defineNuxtConfig({
  compatibilityDate: '2025-07-01',
  nitro: {
    externals: { traceInclude: nodeDatachannelAddons },
  },
  // The documents layer brings the shared block-document system (renderers,
  // <DocumentArticle>, /api/documents over .data/jexplain/) plus, transitively,
  // @jsuite/charting — docs here are the same objects jExplain renders.
  extends: ['@jsuite/documents'],
  modules: ['@nuxt/ui'],
  // Where jDiff lives, so the client can link a project's branch straight into
  // a review. Same override the server side and the jdiff CLI use.
  runtimeConfig: {
    public: {
      jdiffUrl: process.env.JDIFF_URL ?? 'https://jdiff.local',
    },
  },
  css: ['~/assets/css/main.css'],
  devtools: { enabled: true },
  // Pages set a bare page title ('Board', 'DOC-3 — Rollout plan'); app.vue's
  // titleTemplate suffixes ' · jTicket'.
  app: {
    head: {
      title: 'jTicket',
      meta: [{ name: 'description', content: 'Local projects + tickets tracker' }],
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
