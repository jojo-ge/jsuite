// Auto mode (the jButton) from the page's side: the controls, and what the
// loop is waiting on. The loop itself runs on the server
// (server/plugins/autoLoop.ts); every change it makes lands in
// project.auto and reaches the page over /api/stream.
import type { Project } from '~/composables/useTracker'
import type { AutoLoop } from '~/utils/autoLoop'

export function useAutoLoop() {
  const { refresh } = useTracker()
  const toast = useToast()
  const busy = useState<string>('jticket-auto-busy', () => '')

  async function post(project: Project, body: Record<string, boolean>, what: string): Promise<AutoLoop | null> {
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
    turnOff: (p: Project) => post(p, { enabled: false }, 'off'),
    requestStop: (p: Project, stop: boolean) => post(p, { stopRequested: stop }, 'stop'),
    retry: (p: Project) => post(p, { retry: true }, 'retry'),
  }
}
