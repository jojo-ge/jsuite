// Herdr's shape, shared by every page that shows dispatch/go-to buttons.
// One keyed fetch — /next and the project page reuse the same state, and the
// server holds its own ~5s cache over the (multi-call) CLI reads.
export interface HerdrTab {
  tabId: string
  label: string
  paneCount: number
  agentStatus: string | null
  focused: boolean
}
export interface HerdrWorkspace {
  workspaceId: string
  label: string
  focused: boolean
  agentStatus: string | null
  tabs: HerdrTab[]
}
export interface HerdrClientState {
  available: boolean
  workspaces: HerdrWorkspace[]
}

export function useHerdr() {
  const { data, refresh } = useFetch<HerdrClientState>('/api/herdr', {
    key: 'herdr-state',
    lazy: true,
    server: false,
  })
  // Herdr changes outside the store (agents finish, tabs close), so nothing on
  // the SSE stream announces it — poll gently instead. The server holds a ~5s
  // cache over the CLI reads, so overlapping subscribers stay cheap.
  if (import.meta.client) {
    const tick = setInterval(() => refresh(), 15_000)
    onScopeDispose(() => clearInterval(tick))
  }
  const available = computed(() => !!data.value?.available)
  function workspaceByLabel(label: string): HerdrWorkspace | null {
    return data.value?.workspaces.find((w) => w.label === label) ?? null
  }
  async function focus(target: { agent?: string; tab?: string; workspace?: string }) {
    await $fetch('/api/herdr/focus', { method: 'POST', body: target })
    refresh()
  }
  return { herdr: data, available, refresh, workspaceByLabel, focus }
}

export function herdrErrorText(err: any): string {
  return String(err?.data?.statusMessage ?? err?.statusMessage ?? err?.message ?? err)
}
