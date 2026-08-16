/**
 * Where the chart UI lives in *this* app.
 *
 * <ChartLibrary> and <ChartWorkbench> are mounted at /charts in every consumer
 * of the layer, but jChart also aliases them onto `/` and `/c/<key>`. Rather
 * than hardcoding either scheme, the components link through here and each app
 * declares its own paths in `app.config.ts` (see the layer's defaults).
 */
export function useChartRoutes() {
  const { charting } = useAppConfig()
  const index = charting?.indexPath || '/charts'
  const base = (charting?.chartPath || '/charts').replace(/\/+$/, '')
  return {
    /** The chart library. */
    index,
    /** The workbench for one chart. */
    chart: (key: string) => `${base}/${key}`,
  }
}
