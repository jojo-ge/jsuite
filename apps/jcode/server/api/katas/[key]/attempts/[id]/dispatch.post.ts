/**
 * Re-dispatch the marker for an attempt still waiting to be marked — the
 * retry after a failed herdr hand-off (herdr was down, the pane never got
 * its prompt). Same dispatch as Mark it, without a new attempt.
 */
export default defineEventHandler(async (event) => {
  const key = String(getRouterParam(event, 'key'))
  const id = String(getRouterParam(event, 'id'))
  return dispatchMarker(key, id)
})
