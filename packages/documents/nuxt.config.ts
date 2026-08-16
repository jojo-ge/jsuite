import { fileURLToPath } from 'node:url'

// @jsuite/documents — the shared block-based document system, as a Nuxt layer.
//
// A consumer that `extends: ['@jsuite/documents']` gets:
//   - the Block*.vue renderers, <NotesRail>, and <DocumentArticle> (the whole
//     reading experience: blocks + margin note buttons + notes rail)
//   - <DocumentLibrary> and <DocumentReader> — the whole-pool library list and
//     the reading page — plus the pages that mount them at /documents and
//     /documents/<key>. An app that wants them under its own routes (jExplain's
//     / and /e/<key>) mounts the components itself rather than copying them.
//   - useMarkdown() (glossary-aware markdown, block + inline), useShiki(),
//     and useLabelFilter() — the chip bar's selection state and filtered list
//   - labelForBlock(), markdownPreview() and labelPool() app utils
//   - the /api/documents/** routes over the shared .data/jexplain pool, plus
//     the document store as Nitro server auto-imports
//   - types via `@jsuite/documents/types` (client-safe) and
//     `@jsuite/documents/store` (server)
//   - everything from @jsuite/charting (extended below): <ExcalidrawCanvas>,
//     mermaidToScene(), /api/charts/** over the shared .data/jchart pool, and
//     the chart UI itself — /charts and /charts/<key> as pages
//
// Consumers must also add TWO lines to their Tailwind entry css so the utility
// classes used by this layer's components — and by the charting layer's, which
// rides in transitively — are generated:
//   @source "../../../../../packages/documents/app";
//   @source "../../../../../packages/charting/app";
export default defineNuxtConfig({
  extends: ['@jsuite/charting'],
  css: [fileURLToPath(new URL('./app/assets/css/documents.css', import.meta.url))],
  vite: {
    optimizeDeps: {
      // These live in this layer's node_modules, not the app's — point Vite's
      // prebundler through the workspace link (same trick as @jsuite/charting).
      include: ['@jsuite/documents > marked', '@jsuite/documents > shiki'],
    },
  },
})
