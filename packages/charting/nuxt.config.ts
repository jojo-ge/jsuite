// @jsuite/charting — Nuxt layer providing the shared chart canvas AND the shared
// chart store: every consumer serves /api/charts against the same .data/jchart/
// pool, so a chart embedded in one app is the very same object opened in another.
//
// Consumers add `extends: ['@jsuite/charting']` (plus the workspace dep) and get:
//   <ExcalidrawCanvas>  — the Excalidraw editor as a Vue component
//   mermaidToScene()    — Mermaid source → Excalidraw scene (browser-only)
//   scene utils         — trimAppState, liveElements, labelForElement, isAnnotatable
//   /api/charts/**      — CRUD + notes over .data/jchart/<key>.json (via @jsuite/data)
//   types               — '@jsuite/charting/scene', '@jsuite/charting/store'
//
// Apps must also copy the Excalidraw fonts into their public/ dir (postinstall):
//   node ../../packages/charting/scripts/copy-excalidraw-assets.mjs
export default defineNuxtConfig({
  vite: {
    // Excalidraw's bundle branches on these at module scope; without the defines
    // Vite leaves a bare `process` reference that throws in the browser.
    define: {
      'process.env.IS_PREACT': JSON.stringify('false'),
    },
    optimizeDeps: {
      // `pkg > dep` — these live in this layer's node_modules, not the app's,
      // so tell Vite to resolve them through the linked workspace package.
      include: [
        '@jsuite/charting > react',
        '@jsuite/charting > react-dom',
        '@jsuite/charting > react-dom/client',
        '@jsuite/charting > @excalidraw/excalidraw',
      ],
    },
  },
})
