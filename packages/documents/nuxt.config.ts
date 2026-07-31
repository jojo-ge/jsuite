import { fileURLToPath } from 'node:url'

// @jsuite/documents — the shared block-based document system, as a Nuxt layer.
//
// A consumer that `extends: ['@jsuite/documents']` gets:
//   - the Block*.vue renderers, <NotesRail>, and <DocumentArticle> (the whole
//     reading experience: blocks + margin note buttons + notes rail)
//   - useMarkdown() (glossary-aware markdown, block + inline) and useShiki()
//   - labelForBlock() and markdownPreview() app utils
//   - the /api/documents/** routes over the shared .data/jexplain pool, plus
//     the document store as Nitro server auto-imports
//   - types via `@jsuite/documents/types` (client-safe) and
//     `@jsuite/documents/store` (server)
//   - everything from @jsuite/charting (extended below): <ExcalidrawCanvas>,
//     mermaidToScene(), /api/charts/** over the shared .data/jchart pool
//
// Consumers must also add ONE line to their Tailwind entry css so utility
// classes used by this layer's components are generated:
//   @source "../../../../../packages/documents/app";
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
