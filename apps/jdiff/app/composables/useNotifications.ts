export interface AppNotification {
  id: string
  type: 'pr_opened' | 'comment' | 'reaction'
  reason?: 'my_pr' | 'reply'
  prNumber: number
  prTitle?: string
  actor?: string
  emoji?: string
  excerpt?: string
  createdAt: string
  url: string
}

interface ReactionSnapshot {
  id: string
  prNumber: number
  excerpt: string
  counts: Record<string, number>
  url: string
}

interface NotifStore {
  baselineAt: string
  lastReadAt: string
  reactionCounts: Record<string, Record<string, number>>
  reactionEvents: AppNotification[]
}

const EMOJI: Record<string, string> = {
  '+1': '👍',
  '-1': '👎',
  laugh: '😄',
  confused: '😕',
  heart: '❤️',
  hooray: '🎉',
  rocket: '🚀',
  eyes: '👀',
}

const POLL_MS = 60_000

export function useNotifications(repo: Ref<string>) {
  const storageKey = computed(() => `jdiff:notifs:${repo.value}`)
  const store = ref<NotifStore | null>(null)

  function load() {
    try {
      store.value = JSON.parse(localStorage.getItem(storageKey.value) ?? 'null')
    } catch {
      store.value = null
    }
  }
  function save() {
    if (store.value) localStorage.setItem(storageKey.value, JSON.stringify(store.value))
  }

  const { data, refresh } = useFetch<{
    me: string
    events: AppNotification[]
    reactionSnapshots: ReactionSnapshot[]
  }>('/api/notifications', { query: { repo }, server: false, lazy: true })

  watch(repo, load, { immediate: true })

  watch(data, (d) => {
    if (!d) return
    const now = new Date().toISOString()
    if (!store.value) {
      // First poll for this repo: everything that already exists is old news.
      const st: NotifStore = { baselineAt: now, lastReadAt: now, reactionCounts: {}, reactionEvents: [] }
      for (const s of d.reactionSnapshots) st.reactionCounts[s.id] = s.counts
      store.value = st
      save()
      return
    }
    const st = store.value
    const seen = new Set(st.reactionEvents.map((e) => e.id))
    for (const snap of d.reactionSnapshots) {
      const prev = st.reactionCounts[snap.id] ?? {}
      for (const [key, count] of Object.entries(snap.counts)) {
        if (count <= (prev[key] ?? 0)) continue
        const id = `r-${snap.id}-${key}-${count}`
        if (seen.has(id)) continue
        st.reactionEvents.unshift({
          id,
          type: 'reaction',
          emoji: EMOJI[key] ?? key,
          prNumber: snap.prNumber,
          excerpt: snap.excerpt,
          createdAt: now,
          url: snap.url,
        })
      }
      st.reactionCounts[snap.id] = snap.counts
    }
    st.reactionEvents = st.reactionEvents.slice(0, 50)
    save()
  })

  const notifications = computed<AppNotification[]>(() => {
    const st = store.value
    if (!st) return []
    const fresh = (data.value?.events ?? []).filter((e) => e.createdAt > st.baselineAt)
    return [...fresh, ...st.reactionEvents]
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, 50)
  })

  const unreadCount = computed(() => {
    const st = store.value
    if (!st) return 0
    return notifications.value.filter((n) => n.createdAt > st.lastReadAt).length
  })

  function isUnread(n: AppNotification): boolean {
    return !!store.value && n.createdAt > store.value.lastReadAt
  }

  function markAllRead() {
    if (!store.value) return
    store.value.lastReadAt = new Date().toISOString()
    save()
  }

  let timer: ReturnType<typeof setInterval> | undefined
  const onFocus = () => refresh()
  onMounted(() => {
    timer = setInterval(() => refresh(), POLL_MS)
    window.addEventListener('focus', onFocus)
  })
  onUnmounted(() => {
    if (timer) clearInterval(timer)
    window.removeEventListener('focus', onFocus)
  })

  return { notifications, unreadCount, isUnread, markAllRead, refresh }
}
