export default defineAppConfig({
  charting: {
    // Where this app's chart UI is mounted. The layer ships the canonical
    // namespaced routes (/charts, /charts/<key>), so these defaults are right
    // for every consumer that just extends it. jChart overrides them because it
    // aliases the same components onto its short, app-is-the-charts routes.
    indexPath: '/charts',
    chartPath: '/charts',
  },
})
