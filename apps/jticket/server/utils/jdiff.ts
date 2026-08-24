// jTicket's line to jDiff — reviews are dispatched and tracked by jDiff, and
// jTicket talks to it server-side over its HTTP API so the browser never has
// to cross origins. Browser-facing links use JDIFF_BASE (github.ts); this is
// the server-to-server address.

const JDIFF_API = process.env.JDIFF_API_URL || 'http://localhost:43002'

export async function jdiffFetch<T = any>(path: string, opts: any = {}): Promise<T> {
  try {
    return await $fetch<T>(`${JDIFF_API}${path}`, { timeout: 5_000, ...opts })
  } catch (err: any) {
    const status = err?.statusCode ?? err?.response?.status
    if (status) {
      throw createError({
        statusCode: status,
        message: `jDiff said ${status}: ${String(err?.data?.statusMessage ?? err?.data?.message ?? err?.message ?? '').slice(0, 300)}`,
      })
    }
    throw createError({
      statusCode: 503,
      message: 'jDiff is not reachable on :43002 — run ./jsuite status, then ./jsuite start',
    })
  }
}

// What jDiff's analyze-dispatch answers with.
export interface JdReviewDispatch {
  agent: string
  workspaceId: string
  tabId: string
  startedAt: number
  attached: boolean
}

// Dispatching blocks until herdr has the claude session accepting prompts
// (~10s+, with retries) — far past the default fetch timeout.
export const JDIFF_DISPATCH_TIMEOUT = 90_000
