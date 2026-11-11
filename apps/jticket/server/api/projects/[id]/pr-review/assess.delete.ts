// Cancel the assessor: close its pane (best-effort) and clear the mark.
export default defineEventHandler(async (event) => ({ cancelled: await cancelAssessment(String(getRouterParam(event, 'id'))) }))
