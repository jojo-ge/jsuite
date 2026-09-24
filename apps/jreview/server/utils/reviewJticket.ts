// jReview's line to jTicket — the human's "Split into tickets" button, and the
// codebase's worktree guide (where a review's worktree goes). Server-side over
// jTicket's HTTP API so the browser never crosses origins; never touches
// .data/jticket directly.

const JTICKET_BASE = process.env.JTICKET_URL || 'http://localhost:43000'
export const JTICKET_PUBLIC = 'https://jticket.local'

export async function jticketCall<T = any>(path: string, opts: any = {}): Promise<T> {
  try {
    return await $fetch<T>(`${JTICKET_BASE}${path}`, { timeout: 10_000, ...opts })
  } catch (err: any) {
    const status = err?.statusCode ?? err?.response?.status
    if (status) {
      throw createError({
        statusCode: status,
        message: `jTicket said ${status}: ${String(err?.data?.statusMessage ?? err?.data?.message ?? err?.message ?? '').slice(0, 300)}`,
      })
    }
    throw createError({
      statusCode: 503,
      message: 'jTicket is not reachable on :43000 — run ./jsuite status, then ./jsuite start',
    })
  }
}

/** The codebase's worktree guide on jTicket, as a URL an agent can GET. */
export function worktreeGuideUrl(repoPath: string): string {
  return `${JTICKET_BASE}/api/repos/worktree?repo=${encodeURIComponent(repoPath)}`
}

/**
 * How the codebase does worktrees, per jTicket (see jTicket's
 * server/utils/worktrees.ts) — or null when it has no guide, or jTicket is
 * down. Best-effort and quick: a review must still start without it.
 */
export async function codebaseWorktreeGuide(repoPath: string): Promise<{ root: string; url: string } | null> {
  try {
    const res = await $fetch<{ guide: { root: string } | null }>(worktreeGuideUrl(repoPath), { timeout: 2_000 })
    return res.guide ? { root: res.guide.root ?? '', url: worktreeGuideUrl(repoPath) } : null
  } catch {
    return null
  }
}
