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
  // Every consumer renders lucide icons through @nuxt/ui's <UIcon>, most of them
  // via dynamic `:name` bindings (`:name="g.icon"`, `STATE_META[...].icon`, …).
  // @nuxt/icon only bundles the ~43 icons it can statically see (Nuxt UI's own),
  // so those dynamic ones miss the client bundle: at SSR they can't resolve
  // synchronously, render as empty placeholders, then get fetched + filled on the
  // client — a hydration mismatch (and a stream of `[Icon] failed to load` warns).
  // `scan: true` walks every layer's source (app + this layer) for `i-lucide-*`
  // usages and bundles them, so they resolve synchronously on both sides. Set here
  // so all layered apps (jticket/jexplain/jgrilling/jchart) inherit the fix.
  icon: {
    clientBundle: { scan: true },
  },
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
