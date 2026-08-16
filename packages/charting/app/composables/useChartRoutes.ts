/**
 * Where the chart UI lives in *this* app.
 *
 * <ChartLibrary> and <ChartWorkbench> are mounted at /charts in every consumer
 * of the layer, but jChart also aliases them onto `/` and `/c/<key>`. Rather
 * than hardcoding either scheme, everything that links to a chart goes through
 * here and each app declares its own paths in `app.config.ts` — the layer's own
 * `app/app.config.ts` holds the defaults.
 */
export function useChartRoutes() {
  const { charting } = useAppConfig()
  return {
    /** The chart library. */
    index: charting.libraryPath,
    /** The workbench for one chart. */
    chart: (key: string) => `${charting.chartBasePath.replace(/\/+$/, '')}/${key}`,
  }
}
