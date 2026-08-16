export default defineAppConfig({
  // jChart is nothing but charts, so it aliases the layer's chart UI onto
  // shorter routes than the namespaced /charts default every other consumer
  // uses. These are what <ChartLibrary>/<ChartWorkbench> link through.
  charting: {
    libraryPath: '/',
    chartBasePath: '/c',
  },
  ui: {
    colors: {
      primary: 'indigo',
      neutral: 'slate',
    },
  },
})
