// Cancel a Build tour run: esc to its session (best-effort) and stop tracking
// it. The herdr pane stays open. Same target query as GET.
// → { cancelled }
export default defineEventHandler((event) =>
  cancelTour(tourContext(getRouterParam(event, 'id'), getQuery(event))))
