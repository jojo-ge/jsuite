/**
 * The `.data` root on the machine serving this app, as `@jsuite/data` resolved
 * it — published by this layer through `runtimeConfig.public.jsuiteDataRoot`.
 *
 * Anything that pastes an on-disk path for a human (or an agent) to open goes
 * through here rather than writing a location down: a hardcoded repo path is
 * wrong for every other checkout and goes stale the moment this one moves.
 *
 * The root is resolved once when the server evaluates its Nuxt config, not per
 * request — restart the app if the workspace moves under it. `$NUXT_PUBLIC_
 * JSUITE_DATA_ROOT` overrides it without a rebuild.
 */
export function useDataRoot() {
  const root = String(useRuntimeConfig().public.jsuiteDataRoot || '')
  return {
    /** True when the server told us where its pools are. */
    known: !!root,
    /**
     * A path inside a pool, e.g. `pool('jchart')` → `<root>/jchart`. When the
     * root is unknown this says so inline instead of quietly returning a
     * relative path that looks openable but isn't.
     */
    pool: (app: string) => (root ? `${root}/${app}` : `<jsuite>/.data/${app}`),
  }
}
