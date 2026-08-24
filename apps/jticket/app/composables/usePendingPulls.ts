// The serving side's pending pull approvals (jTicket sync, DOC-30). Pending
// requests are in-memory on the server, so this polls GET /api/sync/pulls
// rather than riding the store's SSE. Shared by the project page's approval
// banner (SyncPullRequests) and the header's global indicator
// (SyncPullIndicator); each picks its own cadence.
import type { PendingPullView } from '~~/server/utils/syncServe'

export function usePendingPulls(intervalMs: number) {
  const pulls = ref<PendingPullView[]>([])

  async function poll() {
    try {
      const res = await $fetch<{ pulls: PendingPullView[] }>('/api/sync/pulls')
      pulls.value = res.pulls
    } catch {
      // Keep the last-known list: the whole point is that a request must not
      // vanish unseen, and a transient fetch failure hiding the banner does
      // exactly that. A truly answered/expired pull clears on the next
      // successful poll.
    }
  }

  let timer: ReturnType<typeof setInterval> | undefined
  onMounted(() => {
    poll()
    timer = setInterval(poll, intervalMs)
  })
  onBeforeUnmount(() => {
    if (timer) clearInterval(timer)
  })

  return { pulls, poll }
}
