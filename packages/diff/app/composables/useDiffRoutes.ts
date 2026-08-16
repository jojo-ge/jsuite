import { diffRoutes, readFrom } from '../utils/diffRoutes'
import type { DiffFrom, DiffRoutes } from '../utils/diffRoutes'

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
 *
 * It also carries the host's back-link (`from`) through the review surface: a
 * screen reads it off its own query, and every link it builds passes it on, so
 * the way back out survives navigating between reviews. See `DiffFrom`.
 */
export function useDiffRoutes(): DiffRoutes & { brand: string; from: DiffFrom | null } {
  const { diff } = useAppConfig()
  // Read once at setup, and that is enough: `from` propagates, so every review
  // URL you can reach by clicking already carries the same one. It can only
  // change under a mounted screen if the reader edits the query by hand, which
  // reloads the app anyway.
  const from = readFrom(useRoute().query)

  return {
    /** The product name the review screens brand themselves with. */
    brand: diff.brand,
    /** Where the host wants this screen to be able to send the reader back to. */
    from,
    ...diffRoutes(diff.basePath, from),
  }
}
