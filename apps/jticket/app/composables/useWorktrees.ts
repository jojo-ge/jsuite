// The two worktree hand-offs, shared by codebase settings and the integration
// branch's worktree row:
//
//   kickoff — ask the codebase how it does worktrees; the agent PUTs the
//             answer as the codebase's worktree guide (/api/repos/worktree)
//   connect — check a project's integration branch out in a worktree the
//             guide's way; the agent POSTs the link (/api/projects/:id/worktree)
//
// Both are AI, not mechanics: jTicket only resolves the prompt (the
// 'worktree:*' kinds, through the usual layers) and hands it to herdr. What
// the agents write back arrives over the live stream — watch
// useLiveStatus().revision to refetch.
import type { Codebase } from '~/composables/useCodebase'
import type { Project } from '~/composables/useTracker'

export function useWorktrees() {
  const toast = useToast()
  const { refresh: refreshHerdr } = useHerdr()
  const { kickoffPrompt, connectPrompt } = usePrompts()
  const { refreshCodebases, label } = useCodebase()

  const kickingOff = useState<string | null>('jticket-worktree-kickoff', () => null)
  async function runKickoff(codebase: Codebase) {
    kickingOff.value = codebase.path
    try {
      const res = await $fetch<{ agent: string; workspace: string }>('/api/repos/worktree/herdr', {
        method: 'POST',
        query: { repo: codebase.path },
        body: { prompt: kickoffPrompt(codebase) },
      })
      toast.add({
        title: 'Worktree kickoff running in herdr',
        description: `Agent ${res.agent} in "${res.workspace}" › worktree kickoff — it will ask you what the repo can't tell it.`,
        icon: 'i-lucide-terminal',
        color: 'success',
      })
      refreshHerdr()
    } catch (err: any) {
      toast.add({ title: 'Could not start the kickoff', description: herdrErrorText(err), icon: 'i-lucide-triangle-alert', color: 'error' })
    } finally {
      kickingOff.value = null
    }
  }

  const connecting = useState<string | null>('jticket-worktree-connect', () => null)
  async function runConnect(project: Project): Promise<boolean> {
    connecting.value = project.id
    try {
      const res = await $fetch<{ agent: string }>(`/api/projects/${project.id}/herdr-worktree`, {
        method: 'POST',
        body: { prompt: connectPrompt(project) },
      })
      toast.add({
        title: `Connecting ${project.integrationBranch}`,
        description: `Agent ${res.agent} in tab "${project.key} · worktree". The link shows here once it records it.`,
        icon: 'i-lucide-git-fork',
        color: 'success',
      })
      refreshHerdr()
      return true
    } catch (err: any) {
      toast.add({ title: 'Could not dispatch the connect', description: herdrErrorText(err), icon: 'i-lucide-triangle-alert', color: 'error' })
      return false
    } finally {
      connecting.value = null
    }
  }

  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text)
      toast.add({ title: `${what} prompt copied`, icon: 'i-lucide-clipboard-check', color: 'success' })
    } catch {
      toast.add({ title: 'Could not copy', description: text, icon: 'i-lucide-clipboard-x', color: 'warning' })
    }
  }
  const copyKickoff = (codebase: Codebase) => copy(kickoffPrompt(codebase), 'Kickoff')
  const copyConnect = (project: Project) => copy(connectPrompt(project), 'Connect')

  async function clearGuide(codebase: Codebase) {
    if (!window.confirm(`Drop ${label(codebase)}'s worktree guide? Worktree consumers fall back to plain git worktrees until the kickoff runs again.`)) return
    await $fetch('/api/repos/worktree', { method: 'DELETE', query: { repo: codebase.path } })
    await refreshCodebases()
  }

  return { kickingOff, runKickoff, copyKickoff, connecting, runConnect, copyConnect, clearGuide }
}
