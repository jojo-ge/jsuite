import { diffRoutes } from '../utils/diffRoutes'
import type { DiffRoutes } from '../utils/diffRoutes'

// Deliberately no `export type` re-exports: app/utils is auto-imported, so
// DiffRoute/DiffTargetQuery are already global here, and naming them twice
// makes Nuxt pick a winner between two identical declarations.

/**
 * Where the review UI lives in *this* app.
 *
 * The layer mounts the whole review surface under /diffs in every consumer,
 * but jDiff — which is nothing but reviews — also aliases the same components
 * onto short top-level routes (`/prs`, `/pr/<n>`, `/branch`). Rather than
 * hardcoding either scheme, every link between review screens goes through
 * here and each app declares its own prefix in `app.config.ts`; the layer's own
 * `app/app.config.ts` holds the namespaced defaults.
 *
 * The table itself is `diffRoutes()` in app/utils, so server code — which has
 * no app config to read — can build the same links.
 */
export function useDiffRoutes(): DiffRoutes & { brand: string } {
  const { diff } = useAppConfig()
  return {
    /** The product name the review screens brand themselves with. */
    brand: diff.brand,
    ...diffRoutes(diff.basePath),
  }
}
