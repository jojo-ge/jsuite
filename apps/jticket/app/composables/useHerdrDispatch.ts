// The hand-off machinery — the prompt that puts a ticket in front of an agent,
// and the herdr dispatch that runs it without a copy-paste. Extracted from
// /next so the project page (board header + ticket cards) shares the exact
// same controls: one prompt-target preference, one dispatch queue, one set of
// loading states, whichever page they are driven from.
import type { Project, ProjectMode, Ticket } from '~/composables/useTracker'

// Where the PR lands is a rhythm, not a constant: work that ships on its own
// goes straight to master, while a run of tickets being stacked for one review
// wants every PR pointed at an integration branch. So the prompt is a choice,
// and it sticks between sessions — it changes rarely, and re-picking it on
// every visit is exactly the friction these controls exist to remove.
export const HANDOFF_PROMPTS = [
  {
    label: 'Local PR (merged in jTicket)',
    value: 'local',
    command: (key: string, branch?: string) =>
      `/jimplement ${key} in a worktree${branch ? ` on the existing branch ${branch}` : ''}. When done open a LOCAL PR in jTicket (POST /api/prs) — no push, no GitHub — and tear down the worktree.`,
  },
  {
    label: 'PR to master',
    value: 'master',
    command: (key: string) =>
      `/jimplement ${key} in a worktree. When done open a PR to master and tear down the worktree.`,
  },
  {
    label: 'PR to integration branch',
    value: 'integration',
    command: (key: string) =>
      `/jimplement ${key} in a worktree and open a PR to the integration branch. When done tear down the worktree.`,
  },
] as const
export type PromptTarget = (typeof HANDOFF_PROMPTS)[number]['value']
export const HANDOFF_PROMPT_OPTIONS = HANDOFF_PROMPTS.map((p) => ({ label: p.label, value: p.value }))

export function useHerdrDispatch() {
  const toast = useToast()
  const { available: herdrUp, refresh: refreshHerdr, workspaceByLabel, focus } = useHerdr()

  const promptTarget = useState<PromptTarget>('jticket-prompt-target', () => 'local')
  // The preference is per-browser; load it once on the client and write on
  // change. Every caller registers its own watch — writes are idempotent, and
  // whichever component is still mounted keeps localStorage in sync.
  onMounted(() => {
    const saved = localStorage.getItem('jticket-next-prompt')
    if (saved === 'master' || saved === 'integration' || saved === 'local') promptTarget.value = saved
  })
  watch(promptTarget, (value) => localStorage.setItem('jticket-next-prompt', value))

  const prompt = computed(() => HANDOFF_PROMPTS.find((p) => p.value === promptTarget.value) ?? HANDOFF_PROMPTS[0])

  // Wayfinder and jMap tickets are not implementation work — a wayfinder
  // frontier is research/prototypes/grillings and /jwayfinder is the skill that
  // reads one; a jMap frontier is mapping jobs, and the ticket's jmap:* label
  // picks its skill: jmap:scope → /jmap-scope, jmap:synthesize →
  // /jmap-synthesize, everything else → /jmap-domain. In both modes the
  // hand-off is the bare command: no worktree, no PR target, which is why the
  // prompt picker does not apply to those rows.
  function jmapCommand(t: Ticket) {
    if (t.labels.includes('jmap:scope')) return '/jmap-scope'
    if (t.labels.includes('jmap:synthesize')) return '/jmap-synthesize'
    return '/jmap-domain'
  }
  // An architect frontier is one scan job plus the candidates it created: the
  // arch:scan label picks /jarchitect-scan, everything else is a candidate
  // whose hand-off is its grilling (/jarchitect-grill).
  function archCommand(t: Ticket) {
    return t.labels.includes('arch:scan') ? '/jarchitect-scan' : '/jarchitect-grill'
  }
  function commandLabel(mode: ProjectMode, t: Ticket) {
    if (mode === 'wayfinder') return '/jwayfinder'
    if (mode === 'jmap') return jmapCommand(t)
    if (mode === 'todo') return '/j-grilling'
    if (mode === 'architect') return archCommand(t)
    return '/jimplement'
  }
  function commandFor(t: Ticket, mode: ProjectMode, branch = t.branch) {
    if (mode === 'wayfinder') return `/jwayfinder ${t.key}`
    if (mode === 'jmap') return `${jmapCommand(t)} ${t.key}`
    if (mode === 'todo') return grillCommand(t)
    if (mode === 'architect') return `${archCommand(t)} ${t.key}`
    return prompt.value.command(t.key, branch)
  }

  // A todo's hand-off is an interview, not an implementation — the same shape
  // jGrilling's own dispatch uses (apps/jgrilling .../upnext/[id]/start.post.ts):
  // route the questions through /j-grilling, and land the outcome back on the
  // ticket. The skill is the interviewer's playbook; the prompt stays terse.
  function grillCommand(t: Ticket) {
    return (
      `Grill me about this todo — ${t.key}: "${t.title}". Read the ticket first ` +
      `(GET http://localhost:43000/api/tickets/${t.key}), then run the interview through /j-grilling: ` +
      `post each question to the jGrilling room and monitor the session file for the answer — ` +
      `don't ask in the terminal. When the grilling finishes, write the decisions into ` +
      `${t.key}'s resolution. No branch, no PR.`
    )
  }

  // The local-PR hand-off names the ticket's branch, so jTicket cuts it the
  // moment the prompt is handed off (copied or dispatched) — off the integration
  // branch, local only. A failed cut (no repo, no integration branch) still
  // hands off; the agent will be told to cut a branch itself via POST
  // /api/prs's error. Wayfinder and jMap tickets never get branches — their
  // work is research/docs, not code.
  async function resolveBranch(t: Ticket, mode: ProjectMode): Promise<string> {
    if (mode !== 'standard' || promptTarget.value !== 'local' || t.branch) return t.branch
    try {
      const res = await $fetch<{ branch: string }>(`/api/tickets/${t.id}/branch`, { method: 'POST', body: {} })
      return res.branch
    } catch (err: any) {
      toast.add({
        title: `No branch cut for ${t.key}`,
        description: branchErrorText(err),
        icon: 'i-lucide-git-branch',
        color: 'warning',
      })
      return t.branch
    }
  }

  function workspaceFor(project: Project) {
    return workspaceByLabel(project.title)
  }
  // Only the tabs jTicket names for this project ('PROJ-2', 'PROJ-2 · 3',
  // 'PROJ-2 · merge') become chips — the workspace may hold other tabs too.
  function projectTabs(project: Project) {
    const ws = workspaceFor(project)
    if (!ws) return []
    return ws.tabs.filter((t) => t.label === project.key || t.label.startsWith(`${project.key} · `))
  }

  async function focusHerdr(target: { workspace?: string; tab?: string }) {
    try {
      await focus(target)
    } catch (err: any) {
      toast.add({ title: 'Could not focus herdr', description: herdrErrorText(err), icon: 'i-lucide-triangle-alert', color: 'error' })
    }
  }

  const dispatching = useState<string | null>('jticket-dispatching', () => null)
  // The core dispatch: cut the branch, build the prompt, hand it to herdr.
  // HITL tickets get their own tab — work that will stop and ask for the human
  // deserves a tab of its own, not a quarter of a grid. Throws so run-all can
  // tally failures; the single-ticket button wraps it with its own toasts.
  async function dispatchOne(t: Ticket, mode: ProjectMode) {
    const branch = await resolveBranch(t, mode)
    const res = await $fetch<{ agent: string; tabId: string }>(`/api/tickets/${t.id}/herdr`, {
      method: 'POST',
      body: { prompt: commandFor(t, mode, branch), ownTab: t.type === 'HITL' },
    })
    // Sending a candidate to its grilling IS the triage decision, so the ticket
    // finishes here, at dispatch — not when the interview ends (an abandoned
    // grilling doesn't un-triage it, and re-grilling is just re-dispatching the
    // done ticket). Best-effort: the dispatch already succeeded.
    if (mode === 'architect' && isArchCandidate(t) && !isFinished(t.status)) {
      await $fetch(`/api/tickets/${t.id}`, { method: 'PATCH', body: { status: 'done' } }).catch(() => {})
    }
    return res
  }

  async function dispatchTicket(t: Ticket, mode: ProjectMode) {
    dispatching.value = t.id
    try {
      const res = await dispatchOne(t, mode)
      toast.add({
        title: `${t.key} running in herdr`,
        description: `Agent ${res.agent} — use the tab chip to go watch it.`,
        icon: 'i-lucide-terminal',
        color: 'success',
      })
      refreshHerdr()
    } catch (err: any) {
      toast.add({ title: `Could not dispatch ${t.key}`, description: herdrErrorText(err), icon: 'i-lucide-triangle-alert', color: 'error' })
    } finally {
      dispatching.value = null
    }
  }

  // ── Run all — one project's frontier into herdr, one after another ──
  // Sequential on purpose: parallel dispatches would race the tab creation and
  // pane packing (and each agent start already takes a few seconds anyway).
  // Callers pass the rows they are showing: the tickets you see are the
  // tickets that get dispatched.
  const runningAll = useState<string | null>('jticket-running-all', () => null)
  const runAllProgress = useState<string>('jticket-run-all-progress', () => '')
  async function runAll(project: Project, rows: Array<{ ticket: Ticket; mode: ProjectMode }>) {
    if (!rows.length) return
    runningAll.value = project.id
    let done = 0
    const failed: string[] = []
    try {
      for (const { ticket, mode } of rows) {
        runAllProgress.value = `${done + failed.length + 1}/${rows.length}`
        dispatching.value = ticket.id
        try {
          await dispatchOne(ticket, mode)
          done++
        } catch {
          failed.push(ticket.key)
        }
      }
    } finally {
      dispatching.value = null
      runningAll.value = null
      runAllProgress.value = ''
      refreshHerdr()
    }
    toast.add({
      title: `${done} ${project.key} ticket${done === 1 ? '' : 's'} running in herdr`,
      description: failed.length
        ? `Could not dispatch: ${failed.join(', ')}`
        : 'HITL tickets have their own tabs; use the chips to go watch.',
      icon: failed.length ? 'i-lucide-triangle-alert' : 'i-lucide-terminal',
      color: failed.length ? 'warning' : 'success',
    })
  }

  // ── Cleanup — close the herdr tabs a project's dispatches left behind ──
  // Only jTicket-named tabs ('PROJ-n', 'PROJ-n · …') are closed; the server
  // answers 409 when an agent is still working/blocked in one, and we re-send
  // with force only after the human confirms.
  const cleaningUp = useState<string | null>('jticket-cleaning-up', () => null)
  async function cleanupHerdr(project: Project) {
    cleaningUp.value = project.id
    try {
      let res: { closed: number; workspaceClosed: boolean }
      try {
        res = await $fetch(`/api/projects/${project.id}/herdr-cleanup`, { method: 'POST', body: {} })
      } catch (err: any) {
        if ((err?.statusCode ?? err?.response?.status) !== 409) throw err
        if (!window.confirm(`${herdrErrorText(err)}\n\nClose them anyway? Their agents will be killed.`)) return
        res = await $fetch(`/api/projects/${project.id}/herdr-cleanup`, { method: 'POST', body: { force: true } })
      }
      toast.add({
        title: `Cleaned up ${project.key} in herdr`,
        description: res.workspaceClosed
          ? `Closed the ${project.title} workspace (${res.closed} tab${res.closed === 1 ? '' : 's'}).`
          : `Closed ${res.closed} tab${res.closed === 1 ? '' : 's'}.`,
        icon: 'i-lucide-paintbrush',
        color: 'success',
      })
    } catch (err: any) {
      toast.add({ title: `Could not clean up ${project.key}`, description: herdrErrorText(err), icon: 'i-lucide-triangle-alert', color: 'error' })
    } finally {
      cleaningUp.value = null
      refreshHerdr()
    }
  }

  // ── Grill — dispatch a todo's interview into herdr ──
  // Same plumbing as dispatchOne with its own toast and loading state; always
  // ownTab, because an interview is HITL by definition. The cwd lands in the
  // codebase for free: the TODO project's repo is the codebase path.
  const grilling = useState<string | null>('jticket-grilling', () => null)
  async function grillTicket(t: Ticket) {
    grilling.value = t.id
    try {
      const res = await $fetch<{ agent: string; tabId: string }>(`/api/tickets/${t.id}/herdr`, {
        method: 'POST',
        body: { prompt: grillCommand(t), ownTab: true },
      })
      toast.add({
        title: `${t.key} grilling in herdr`,
        description: `Agent ${res.agent} — answer the questions at https://jgrilling.local.`,
        icon: 'i-lucide-messages-square',
        color: 'success',
      })
      refreshHerdr()
    } catch (err: any) {
      toast.add({ title: `Could not start the grilling for ${t.key}`, description: herdrErrorText(err), icon: 'i-lucide-triangle-alert', color: 'error' })
    } finally {
      grilling.value = null
    }
  }

  const copied = useState<string | null>('jticket-copied-command', () => null)
  async function copyCommand(t: Ticket, mode: ProjectMode) {
    const branch = await resolveBranch(t, mode)
    const command = commandFor(t, mode, branch)
    try {
      await navigator.clipboard.writeText(command)
      copied.value = t.id
      setTimeout(() => {
        if (copied.value === t.id) copied.value = null
      }, 1600)
    } catch {
      // Clipboard access can be refused (an insecure origin, a denied prompt) —
      // show the command so it is still copyable by hand.
      toast.add({ title: 'Could not copy', description: command, icon: 'i-lucide-clipboard-x', color: 'warning' })
    }
  }

  return {
    herdrUp,
    refreshHerdr,
    promptTarget,
    prompt,
    commandLabel,
    commandFor,
    workspaceFor,
    projectTabs,
    focusHerdr,
    dispatching,
    dispatchOne,
    dispatchTicket,
    runningAll,
    runAllProgress,
    runAll,
    cleaningUp,
    cleanupHerdr,
    grilling,
    grillTicket,
    copied,
    copyCommand,
  }
}
