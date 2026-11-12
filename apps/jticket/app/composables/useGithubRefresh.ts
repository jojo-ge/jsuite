// jTicket's GitHub reads are answered from the server's cache
// (server/utils/ghCache.ts): an aged answer comes back at once, marked
// `refreshing` while a fresher one is fetched behind it. This asks again until
// that one has landed, so a page shows what it had immediately and settles a
// moment later — without anyone pressing refresh.
import type { Ref } from 'vue'

const DELAY_MS = 1500
const TRIES = 8

export function useRefetchWhileRefreshing(data: Ref<{ refreshing?: boolean } | null | undefined>, refetch: () => unknown) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let tries = 0
  const stop = () => {
    if (timer) clearTimeout(timer)
    timer = undefined
  }
  // Every response is a new object, so this runs once per answer.
  watch(data, (d) => {
    stop()
    if (!d?.refreshing) {
      tries = 0
      return
    }
    if (!import.meta.client || tries++ >= TRIES) return
    timer = setTimeout(refetch, DELAY_MS)
  }, { immediate: true })
  onScopeDispose(stop)
}

/** "just now" / "4m ago" for a read's `fetchedAt`, against a ticking `now`. */
export function fetchedAgo(iso: string | undefined, now: Date): string {
  if (!iso) return ''
  const s = Math.max(0, (now.getTime() - new Date(iso).getTime()) / 1000)
  if (s < 45) return 'just now'
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}
