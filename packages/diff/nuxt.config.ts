// Server-only Nuxt layer: everything lives in server/utils and reaches
// consumers through Nitro's layer auto-imports (buildDiff, prepareTarget,
// highlightLines, run, …) — there are no components, pages or client deps,
// so the layer config itself has nothing to declare.
export default defineNuxtConfig({})
