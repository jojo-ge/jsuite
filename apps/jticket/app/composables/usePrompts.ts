// The prompt layer, as the pages use it: the editable global defaults (loaded
// once per browser session), each codebase's overrides (off the codebase list,
// GET /api/repos), and the builders every hand-off goes through.
//
// Layer order and the templates themselves live in ~/utils/prompts.ts; this
// composable is what binds them to the defaults fetched from the server, so a
// caller never has to remember to pass them.
import type { Project, ProjectMode, Ticket } from '~/composables/useTracker'
import type { Codebase } from '~/composables/useCodebase'
import type { CodebasePrompts, PromptKind, PromptOverrides } from '~/utils/prompts'

export function usePrompts() {
  // Shared across every component on the page — one fetch, one source.
  const defaults = useState<PromptOverrides>('jticket-prompt-defaults', () => ({}))
  const loaded = useState<boolean>('jticket-prompt-defaults-loaded', () => false)
  const requested = useState<boolean>('jticket-prompt-defaults-requested', () => false)
  // The codebase layer rides on the codebase list the header already loads;
  // a page without the header still gets it, once.
  const { codebases, refreshCodebases, codebaseOf } = useCodebase()
  const codebasesRequested = useState<boolean>('jticket-prompt-codebases-requested', () => false)

  async function refresh() {
    // Claim the one-shot load here rather than at the call site, so a page that
    // fetches during SSR (the /prompts editor) also stops the client-side one.
    requested.value = true
    const res = await $fetch<{ prompts: PromptOverrides }>('/api/prompts')
    defaults.value = res.prompts ?? {}
    loaded.value = true
  }

  // Fired once, and never awaited by the builders: a prompt built before the
  // defaults land falls through to the built-in template, which is what an
  // unconfigured jTicket fires anyway. The state is reactive, so anything
  // rendering a preview re-renders the moment the real defaults arrive.
  if (import.meta.client && !requested.value) {
    requested.value = true
    refresh().catch(() => {
      requested.value = false
    })
  }
  if (import.meta.client && !codebasesRequested.value && !codebases.value.length) {
    codebasesRequested.value = true
    refreshCodebases().catch(() => {
      codebasesRequested.value = false
    })
  }

  /** Merge-patch the global defaults: a kind set to '' drops back to the built-in. */
  async function saveDefaults(patch: PromptOverrides) {
    const res = await $fetch<{ prompts: PromptOverrides }>('/api/prompts', {
      method: 'PATCH',
      body: { prompts: patch },
    })
    defaults.value = res.prompts ?? {}
    loaded.value = true
  }

  /**
   * The template a kind resolves to, and which layer supplied it. The codebase
   * layer is the project's own codebase unless one is passed explicitly —
   * null skips it (the codebase editor asking what lies beneath it).
   */
  function templateFor(
    kind: PromptKind,
    project?: (Pick<Project, 'prompts'> & { repoPath?: string }) | null,
    codebase?: CodebasePrompts,
  ) {
    const layer = codebase === undefined ? codebaseOf(project) : codebase
    return promptTemplateFor(kind, project, defaults.value, layer)
  }

  /** Every layer, for one ticket's hand-off. */
  function ticketPrompt(
    ticket: Ticket,
    project: Project | null | undefined,
    mode: ProjectMode,
    target: 'local' | 'master' | 'integration',
    branch?: string,
  ) {
    return resolveTicketPrompt({ ticket, project, mode, target, defaults: defaults.value, codebase: codebaseOf(project), branch })
  }

  /** The project-level merge sweep — layers 2–5; there is no ticket to override it. */
  function mergePrompt(project: Project, prKeys: string[]) {
    return resolveMergePrompt(project, prKeys, defaults.value, codebaseOf(project))
  }

  /** The integration branch's connect prompt — layers 2–5, like the sweep. */
  function connectPrompt(project: Project) {
    return resolveConnectPrompt(project, defaults.value, codebaseOf(project))
  }

  /** A codebase's worktree kickoff — layers 3–5. */
  function kickoffPrompt(codebase: Pick<Codebase, 'path' | 'prompts'>) {
    return resolveKickoffPrompt(codebase, defaults.value)
  }

  return { defaults, loaded, refresh, saveDefaults, templateFor, ticketPrompt, mergePrompt, connectPrompt, kickoffPrompt }
}
