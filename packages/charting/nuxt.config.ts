import { fileURLToPath } from 'node:url'
import { dataRoot } from '@jsuite/data'

// @jsuite/charting — Nuxt layer providing the shared chart canvas AND the shared
// chart store: every consumer serves /api/charts against the same .data/jchart/
// pool, so a chart embedded in one app is the very same object opened in another.
//
// Consumers add `extends: ['@jsuite/charting']` (plus the workspace dep) and get:
//   /charts, /charts/<key> — the chart library and the full workbench, as pages
//   <ChartLibrary>, <ChartWorkbench>, <ChartNotesPanel> — the same UI, to mount
//                         anywhere else (jChart aliases them onto / and /c/<key>)
//   useChartRoutes()    — where this app mounts that UI (see app/app.config.ts)
//   <ExcalidrawCanvas>  — the Excalidraw editor as a Vue component
//   mermaidToScene()    — Mermaid source → Excalidraw scene (browser-only)
//   scene utils         — trimAppState, liveElements, labelForElement, isAnnotatable
//   /api/charts/**      — CRUD + notes over .data/jchart/<key>.json (via @jsuite/data)
//   types               — '@jsuite/charting/scene', '@jsuite/charting/store'
//   runtimeConfig.public.jsuiteDataRoot — the `.data` root as @jsuite/data resolves
//                         it, for components that paste on-disk paths
//
// Apps must also copy the Excalidraw fonts into their public/ dir (postinstall):
//   node ../../packages/charting/scripts/copy-excalidraw-assets.mjs
// and add ONE line to their Tailwind entry css so the utility classes this
// layer's components use are generated:
//   @source "../../../../../packages/charting/app";
export default defineNuxtConfig({
  css: [fileURLToPath(new URL('./app/assets/css/charting.css', import.meta.url))],
  // The `.data` root, resolved the same way the server resolves it, published to
  // the client. The copy-for-Claude outputs paste absolute on-disk paths so the
  // agent can open the user's notes directly; without this they'd have to
  // hardcode a repo location, which is exactly what goes stale when the
  // workspace moves. Override at runtime with $NUXT_PUBLIC_JSUITE_DATA_ROOT.
  runtimeConfig: {
    public: {
      jsuiteDataRoot: dataRoot(),
    },
  },
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
