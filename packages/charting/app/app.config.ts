export default defineAppConfig({
  charting: {
    // Where this app mounts the chart UI. The layer ships the canonical
    // namespaced routes, so these defaults are right for every consumer that
    // just extends it; jChart overrides them because it aliases the same
    // components onto shorter, the-app-is-the-charts routes.
    /** Full path of the chart library. */
    libraryPath: '/charts',
    /** Prefix a chart's key hangs off: `<chartBasePath>/<key>`. */
    chartBasePath: '/charts',
  },
})
