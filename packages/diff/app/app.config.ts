import { DIFF_BASE_PATH } from './utils/diffRoutes'

export default defineAppConfig({
  diff: {
    // Where this app mounts the review UI. The layer ships the canonical
    // namespaced routes, so this default is right for every consumer that just
    // extends it; jDiff overrides it because it aliases the same components
    // onto short, the-app-is-the-reviews routes at the root.
    /** Prefix every review route hangs off — '' puts them at the root. */
    basePath: DIFF_BASE_PATH,
    // What the review screens call themselves in their header — and it is the
    // *app*, not the layer, because it links to `routes.home`: in a host that
    // is the host's own diffs page, wearing the host's chrome, so it has to be
    // spelled the way the door it opens is. jDiff says 'jDiff', jTicket says
    // 'jTicket'; this is what a consumer that has not thought about it gets.
    // (Naming the app here does not get anyone back to the *record* they came
    // from — that is `DiffFrom` and <DiffHostBackLink>. See "Getting back out
    // of a review" in the root README.)
    /** What the review screens call themselves in their header. */
    brand: 'diffs',
  },
})
