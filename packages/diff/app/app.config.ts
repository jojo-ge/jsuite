import { DIFF_BASE_PATH } from './utils/diffRoutes'

export default defineAppConfig({
  diff: {
    // Where this app mounts the review UI. The layer ships the canonical
    // namespaced routes, so this default is right for every consumer that just
    // extends it; jDiff overrides it because it aliases the same components
    // onto short, the-app-is-the-reviews routes at the root.
    /** Prefix every review route hangs off — '' puts them at the root. */
    basePath: DIFF_BASE_PATH,
    /** What the review screens call themselves in their header. */
    brand: 'diffs',
  },
})
