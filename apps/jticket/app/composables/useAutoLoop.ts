// Auto mode (the jButton) from the page's side: the controls, and what the
// loop is waiting on. The loop itself runs on the server
// (server/plugins/autoLoop.ts); every change it makes lands in
// project.auto and reaches the page over /api/stream.
import type { Project, Ticket } from '~/composables/useTracker'
import type { AutoLoop } from '~/utils/autoLoop'
import { forecastLoops, type AutoForecast } from '~/utils/autoForecast'

export function useAutoLoop() {
  const { refresh } = useTracker()
  const toast = useToast()
  const busy = useState<string>('jticket-auto-busy', () => '')

  async function post(project: Project, body: Record<string, boolean | string[]>, what: string): Promise<AutoLoop | null> {
    busy.value = what
    try {
      const auto = await $fetch<AutoLoop>(`/api/projects/${project.id}/auto`, { method: 'POST', body })
      await refresh()
      return auto
    } catch (err: any) {
      toast.add({
        title: 'jButton',
        description: String(err?.data?.statusMessage ?? err?.data?.message ?? err?.message ?? err),
        icon: 'i-lucide-triangle-alert',
        color: 'error',
      })
      throw err
    } finally {
      busy.value = ''
    }
  }

  return {
    busy,
    start: (p: Project) => post(p, { enabled: true }, 'start'),
    // One loop only (the board's "Run as loop"): over the given ticket keys,
    // or the whole AFK frontier when none are given; auto turns off after it.
    runLoop: (p: Project, tickets?: string[]) =>
      post(p, { enabled: true, once: true, ...(tickets?.length ? { tickets } : {}) }, 'loop'),
    turnOff: (p: Project) => post(p, { enabled: false }, 'off'),
    requestStop: (p: Project, stop: boolean) => post(p, { stopRequested: stop }, 'stop'),
    retry: (p: Project) => post(p, { retry: true }, 'retry'),
  }
}

/**
 * The jButton's forecast for a project (utils/autoForecast.ts): how many loops
 * auto mode would run from here and which loop each open ticket lands in.
 * With auto on mid-loop, the loop in progress is loop 1.
 */
export function autoForecastFor(project: Project, tickets: Ticket[], all: Ticket[]): AutoForecast {
  const inProject = new Set(tickets.map((t) => t.id))
  const byId = new Map(all.map((t) => [t.id, t]))
  // The project's tickets, plus whatever outside them they wait on.
  const outside = [...new Set(tickets.flatMap((t) => t.blockedBy))].filter((id) => !inProject.has(id))
  const rows = [...tickets, ...outside.map((id) => byId.get(id)).filter((t): t is Ticket => !!t)]
  const auto = project.auto
  const midLoop = !!auto?.enabled && auto.phase !== 'idle' && auto.phase !== 'reporting'
  const keyToId = new Map(tickets.map((t) => [t.key, t.id]))
  const current = midLoop
    ? [...auto!.tickets, ...auto!.fixTickets].map((k) => keyToId.get(k)).filter((id): id is string => !!id)
    : []
  return forecastLoops(
    rows.map((t) => {
      const open = !isFinished(t.status)
      return {
        id: t.id,
        inProject: inProject.has(t.id),
        open,
        hitl: isHitl(t),
        takeable: t.status === 'todo' && !t.assignee && !t.transfer && !peerNameOf(t, project),
        running: open && (t.status !== 'todo' || !!t.assignee),
        blockedBy: t.blockedBy,
      }
    }),
    current,
  )
}
