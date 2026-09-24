// jTicket's line to jReview — the auto loop asks it for a consensus review of
// each loop's changes and polls it until the consensus session has filed its
// tickets. Server-to-server; browser links use JREVIEW_PUBLIC.

const JREVIEW_API = process.env.JREVIEW_API_URL || 'http://localhost:43008'
export const JREVIEW_PUBLIC = process.env.JREVIEW_URL || 'https://jreview.local'

export async function jreviewFetch<T = any>(path: string, opts: any = {}): Promise<T> {
  try {
    return await $fetch<T>(`${JREVIEW_API}${path}`, { timeout: 10_000, ...opts })
  } catch (err: any) {
    const status = err?.statusCode ?? err?.response?.status
    if (status) {
      throw createError({
        statusCode: status,
        message: `jReview said ${status}: ${String(err?.data?.statusMessage ?? err?.data?.message ?? err?.message ?? '').slice(0, 300)}`,
      })
    }
    throw createError({
      statusCode: 503,
      message: 'jReview is not reachable on :43008 — run ./jsuite status, then ./jsuite start',
    })
  }
}

/** The slice of a jReview review the auto loop reads. */
export interface JreviewReview {
  key: string
  status: 'reviewing' | 'triaging' | 'triaged' | 'ticketed'
  tickets: { projectKey: string; ticketKeys: string[] } | null
}
