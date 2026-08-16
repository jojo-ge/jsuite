export default defineEventHandler((event) => discardRun(getRouterParam(event, 'id')!))
