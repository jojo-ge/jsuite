// The prompt layer, as the pages use it: the editable global defaults (loaded
// once per browser session) plus the two builders every hand-off goes through.
//
// Layer order and the templates themselves live in ~/utils/prompts.ts; this
// composable is what binds them to the defaults fetched from the server, so a
// caller never has to remember to pass them.
import type { Project, ProjectMode, Ticket } from '~/composables/useTracker'
import type { PromptKind, PromptOverrides } from '~/utils/prompts'

export function usePrompts() {
  // Shared across every component on the page — one fetch, one source.
  const defaults = useState<PromptOverrides>('jticket-prompt-defaults', () => ({}))
  const loaded = useState<boolean>('jticket-prompt-defaults-loaded', () => false)
  const requested = useState<boolean>('jticket-prompt-defaults-requested', () => false)

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

  /** Merge-patch the global defaults: a kind set to '' drops back to the built-in. */
  async function saveDefaults(patch: PromptOverrides) {
    const res = await $fetch<{ prompts: PromptOverrides }>('/api/prompts', {
      method: 'PATCH',
      body: { prompts: patch },
    })
    defaults.value = res.prompts ?? {}
    loaded.value = true
  }

  /** The template a kind resolves to for a project, and which layer supplied it. */
  function templateFor(kind: PromptKind, project?: Pick<Project, 'prompts'> | null) {
    return promptTemplateFor(kind, project, defaults.value)
  }

  /** All four layers, for one ticket's hand-off. */
  function ticketPrompt(
    ticket: Ticket,
    project: Project | null | undefined,
    mode: ProjectMode,
    target: 'local' | 'master' | 'integration',
    branch?: string,
  ) {
    return resolveTicketPrompt({ ticket, project, mode, target, defaults: defaults.value, branch })
  }

  /** The project-level merge sweep — layers 2–4; there is no ticket to override it. */
  function mergePrompt(project: Project, prKeys: string[]) {
    return resolveMergePrompt(project, prKeys, defaults.value)
  }

  return { defaults, loaded, refresh, saveDefaults, templateFor, ticketPrompt, mergePrompt }
}
