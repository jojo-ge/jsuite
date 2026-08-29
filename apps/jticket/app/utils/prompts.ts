// The hand-off prompts, and the four layers that decide which text gets fired.
//
// jTicket's whole agent hand-off is one string: the prompt pasted into a herdr
// pane (or copied to the clipboard). Which string that is resolves through
// four layers, each falling back to the one under it:
//
//   1. the ticket's own text          ticket.prompt + ticket.promptMode
//   2. the project's override         project.prompts[kind]
//   3. the editable global default    GET/PATCH /api/prompts
//   4. the code default               PROMPT_KIND_META[kind].template  ← here
//
// Layers 2–4 are templates rendered with the ticket's/project's values (see
// PROMPT_VARS); layer 1 either appends to or replaces the result. With nothing
// overridden anywhere, every prompt is byte-identical to what jTicket fired
// before overrides existed — the code defaults below ARE the old literals.
//
// The client twin of server/utils/prompts.ts (which owns storage and the same
// PROMPT_KINDS list); tests/prompts.test.ts holds the two lists together.

import type { Project, ProjectMode, Ticket } from '~/composables/useTracker'

export const PROMPT_KINDS = [
  'standard:local',
  'standard:master',
  'standard:integration',
  'wayfinder',
  'jmap:scope',
  'jmap:domain',
  'jmap:synthesize',
  'todo',
  'architect:scan',
  'architect:grill',
  'predeploy',
  'merge',
] as const
export type PromptKind = (typeof PROMPT_KINDS)[number]
export type PromptOverrides = Partial<Record<PromptKind, string>>
export type TicketPromptMode = '' | 'append' | 'replace'

/** Everything a template can interpolate. Absent values render as ''. */
export interface PromptVars {
  key: string
  title: string
  branch: string
  /** ` on the existing branch <b>` — empty when no branch is cut. */
  onBranch: string
  projectKey: string
  projectTitle: string
  repo: string
  integrationBranch: string
  /** The merge sweep's queue, e.g. 'PR-3, PR-4'. */
  prs: string
}

/** The variables a given kind's editor advertises, in the order they read best. */
const TICKET_VARS = ['key', 'title', 'branch', 'onBranch', 'projectKey', 'projectTitle', 'repo', 'integrationBranch'] as const
const MERGE_VARS = ['prs', 'projectKey', 'projectTitle', 'repo', 'integrationBranch'] as const

export const PROMPT_VAR_HINTS: Record<keyof PromptVars, string> = {
  key: "the ticket's key, e.g. TICK-42",
  title: "the ticket's title",
  branch: "the ticket's work branch, empty until one is cut",
  onBranch: "' on the existing branch <name>' — empty when no branch is cut",
  projectKey: "the project's key, e.g. PROJ-3",
  projectTitle: "the project's title",
  repo: "the project's local clone path",
  integrationBranch: "the project's integration branch",
  prs: "the merge queue, e.g. 'PR-3, PR-4'",
}

export interface PromptKindMeta {
  /** What the editor calls it. */
  label: string
  /** Why it fires — one line under the label. */
  hint: string
  /** The heading it sits under in the editor. */
  group: string
  /** What the copy button says, and what the prompt normally starts with. */
  command: string
  /** The variables this kind renders. */
  vars: ReadonlyArray<keyof PromptVars>
  /** The built-in text — layer 4, and the editor's placeholder. */
  template: string
}

export const PROMPT_KIND_META: Record<PromptKind, PromptKindMeta> = {
  'standard:local': {
    label: 'Local PR (merged in jTicket)',
    hint: 'Standard tickets, with the hand-off picker set to a local PR.',
    group: 'Implementation',
    command: '/jimplement',
    vars: TICKET_VARS,
    template:
      '/jimplement {key} in a worktree{onBranch}. When done open a LOCAL PR in jTicket (POST /api/prs) — no push, no GitHub — and tear down the worktree.',
  },
  'standard:master': {
    label: 'PR to master',
    hint: 'Standard tickets, with the hand-off picker set to master.',
    group: 'Implementation',
    command: '/jimplement',
    vars: TICKET_VARS,
    template: '/jimplement {key} in a worktree. When done open a PR to master and tear down the worktree.',
  },
  'standard:integration': {
    label: 'PR to integration branch',
    hint: "Standard tickets, with the hand-off picker set to the project's integration branch.",
    group: 'Implementation',
    command: '/jimplement',
    vars: TICKET_VARS,
    template:
      '/jimplement {key} in a worktree and open a PR to the integration branch. When done tear down the worktree.',
  },
  wayfinder: {
    label: 'Wayfinder ticket',
    hint: 'Every ticket in a wayfinder project — research, prototypes, grillings.',
    group: 'Wayfinder',
    command: '/jwayfinder',
    vars: TICKET_VARS,
    template: '/jwayfinder {key}',
  },
  'jmap:scope': {
    label: 'jMap scope',
    hint: "The jmap:scope ticket — the pass that carves the repo into domains.",
    group: 'jMap',
    command: '/jmap-scope',
    vars: TICKET_VARS,
    template: '/jmap-scope {key}',
  },
  'jmap:domain': {
    label: 'jMap domain',
    hint: 'Every other mapping ticket — one domain documented per ticket.',
    group: 'jMap',
    command: '/jmap-domain',
    vars: TICKET_VARS,
    template: '/jmap-domain {key}',
  },
  'jmap:synthesize': {
    label: 'jMap synthesize',
    hint: 'The jmap:synthesize ticket — the docs folded into one dependency map.',
    group: 'jMap',
    command: '/jmap-synthesize',
    vars: TICKET_VARS,
    template: '/jmap-synthesize {key}',
  },
  todo: {
    label: 'Todo grilling',
    hint: "A todo-list ticket's interview, run in the herdr terminal.",
    group: 'Todo',
    command: '/grilling',
    vars: TICKET_VARS,
    template:
      'Grill me about this todo — {key}: "{title}". Read the ticket first ' +
      '(GET http://localhost:43000/api/tickets/{key}), then run /grilling here in the terminal — ' +
      'I answer in this pane. Only if I ask for one question in the browser, escalate that ' +
      'single question with /j-grilling. When the grilling finishes, write the decisions into ' +
      "{key}'s resolution. No branch, no PR.",
  },
  'architect:scan': {
    label: 'Architecture scan',
    hint: 'The arch:scan ticket — the pass that fills the board with graded candidates.',
    group: 'Architecture',
    command: '/jarchitect-scan',
    vars: TICKET_VARS,
    template: '/jarchitect-scan {key}',
  },
  'architect:grill': {
    label: 'Architecture candidate grilling',
    hint: "A candidate's go/no-go interview. Dispatching it is the triage decision.",
    group: 'Architecture',
    command: '/jarchitect-grill',
    vars: TICKET_VARS,
    template: '/jarchitect-grill {key}',
  },
  predeploy: {
    label: 'Pre-deploy reproduction',
    hint: 'Every ticket in a predeploy project — one suspected bug reproduced, never fixed.',
    group: 'Predeploy',
    command: '/jreproduce',
    vars: TICKET_VARS,
    template: '/jreproduce {key}',
  },
  merge: {
    label: 'Merge sweep',
    hint: "The project-level sweep that lands every open local PR. Not a ticket — no per-ticket override.",
    group: 'Merge',
    command: 'Merge sweep',
    vars: MERGE_VARS,
    template: [
      "Merge {projectKey}'s open local jTicket PRs into its integration branch {integrationBranch}, oldest first: {prs}.",
      'For each one: POST http://localhost:43000/api/prs/<key>/merge.',
      "On a 409 conflict: in the repo at {repo}, rebase that PR's head branch onto {integrationBranch}, resolve the conflicts preserving both sides' intent, then POST the merge again.",
      'Everything stays local — do not push or touch GitHub.',
    ].join(' '),
  },
}

/** The editor's sections, in the order they render. */
export const PROMPT_GROUPS = ['Implementation', 'Wayfinder', 'jMap', 'Todo', 'Architecture', 'Predeploy', 'Merge'] as const
export function promptKindsInGroup(group: string): PromptKind[] {
  return PROMPT_KINDS.filter((k) => PROMPT_KIND_META[k].group === group)
}

/** Every kind but the sweep — the ones a single ticket can fire. */
export const TICKET_PROMPT_KINDS = PROMPT_KINDS.filter((k) => k !== 'merge')

/**
 * A variable as it reads in a template — '{key}'. A helper rather than an
 * inline literal because `{…}` inside a Vue mustache is a parse error, and the
 * editors show these tokens everywhere.
 */
export function promptVarToken(name: string): string {
  return `{${name}}`
}
/** Every variable a kind renders, ready to print: '{key} {title} …'. */
export function promptVarTokens(kind: PromptKind): string {
  return PROMPT_KIND_META[kind].vars.map(promptVarToken).join(' ')
}

export function isPromptKind(v: unknown): v is PromptKind {
  return typeof v === 'string' && (PROMPT_KINDS as readonly string[]).includes(v)
}

// ── Rendering ───────────────────────────────────────────────────────────────
// Plain {name} substitution against the vars a kind advertises. An unknown
// placeholder is left standing rather than blanked: a typo you can see in the
// dispatched prompt is a typo you can fix, and a silent gap is not.
export function renderPrompt(template: string, vars: Partial<PromptVars>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = (vars as Record<string, unknown>)[name]
    return typeof value === 'string' ? value : whole
  })
}

export function ticketPromptVars(
  ticket: Pick<Ticket, 'key' | 'title'> & { branch?: string },
  project: Pick<Project, 'key' | 'title' | 'repo' | 'integrationBranch'> | null | undefined,
  branch = ticket.branch ?? '',
): PromptVars {
  return {
    key: ticket.key,
    title: ticket.title,
    branch,
    onBranch: branch ? ` on the existing branch ${branch}` : '',
    projectKey: project?.key ?? '',
    projectTitle: project?.title ?? '',
    repo: project?.repo ?? '',
    integrationBranch: project?.integrationBranch ?? '',
    prs: '',
  }
}

// ── Which kind is this hand-off? ────────────────────────────────────────────
// The same branching the dispatch used to do inline: a project's mode picks
// the family, and inside jMap and architect mode the ticket's label picks the
// job. Standard mode is the only one the hand-off picker applies to.
export function jmapPromptKind(ticket: Pick<Ticket, 'labels'>): PromptKind {
  if (ticket.labels.includes('jmap:scope')) return 'jmap:scope'
  if (ticket.labels.includes('jmap:synthesize')) return 'jmap:synthesize'
  return 'jmap:domain'
}

export function promptKindFor(
  mode: ProjectMode,
  ticket: Pick<Ticket, 'labels'>,
  target: 'local' | 'master' | 'integration',
): PromptKind {
  if (mode === 'wayfinder') return 'wayfinder'
  if (mode === 'jmap') return jmapPromptKind(ticket)
  if (mode === 'todo') return 'todo'
  if (mode === 'architect') return ticket.labels.includes('arch:scan') ? 'architect:scan' : 'architect:grill'
  if (mode === 'predeploy') return 'predeploy'
  return `standard:${target}` as PromptKind
}

// ── The layers ──────────────────────────────────────────────────────────────
/** Layers 2–4: the template this kind resolves to for this project. */
export function promptTemplateFor(
  kind: PromptKind,
  project: Pick<Project, 'prompts'> | null | undefined,
  defaults: PromptOverrides,
): { template: string; layer: 'project' | 'default' | 'built-in' } {
  const own = project?.prompts?.[kind]
  if (own) return { template: own, layer: 'project' }
  const fallback = defaults[kind]
  if (fallback) return { template: fallback, layer: 'default' }
  return { template: PROMPT_KIND_META[kind].template, layer: 'built-in' }
}

export interface ResolvedPrompt {
  kind: PromptKind
  /** The text that actually gets fired. */
  text: string
  /** Which layer supplied the template (before any ticket text). */
  layer: 'project' | 'default' | 'built-in'
  /** What the ticket's own text did to it. */
  ticketMode: TicketPromptMode
  /** True when anything but the built-in template alone produced this. */
  custom: boolean
}

/** All four layers, for one ticket's hand-off. */
export function resolveTicketPrompt(input: {
  ticket: Pick<Ticket, 'key' | 'title' | 'labels'> & { branch?: string; prompt?: string; promptMode?: TicketPromptMode }
  project: Pick<Project, 'key' | 'title' | 'repo' | 'integrationBranch' | 'prompts'> | null | undefined
  mode: ProjectMode
  target: 'local' | 'master' | 'integration'
  defaults: PromptOverrides
  /** The branch as of this hand-off — the dispatch cuts it just before asking. */
  branch?: string
}): ResolvedPrompt {
  const { ticket, project, mode, target, defaults } = input
  const kind = promptKindFor(mode, ticket, target)
  const { template, layer } = promptTemplateFor(kind, project, defaults)
  const vars = ticketPromptVars(ticket, project, input.branch ?? ticket.branch ?? '')

  const own = (ticket.prompt ?? '').trim()
  const ticketMode: TicketPromptMode = own ? (ticket.promptMode ?? '') : ''

  const base = renderPrompt(template, vars)
  const extra = ticketMode ? renderPrompt(own, vars) : ''
  const text = ticketMode === 'replace' ? extra : ticketMode === 'append' ? `${base}\n\n${extra}` : base

  return { kind, text, layer, ticketMode, custom: layer !== 'built-in' || ticketMode !== '' }
}

/** The project-level sweep, resolved through layers 2–4 (it has no ticket). */
export function resolveMergePrompt(
  project: Pick<Project, 'key' | 'title' | 'repo' | 'integrationBranch' | 'prompts'>,
  prKeys: string[],
  defaults: PromptOverrides,
): string {
  const { template } = promptTemplateFor('merge', project, defaults)
  return renderPrompt(template, {
    key: '',
    title: '',
    branch: '',
    onBranch: '',
    projectKey: project.key,
    projectTitle: project.title,
    repo: project.repo,
    integrationBranch: project.integrationBranch,
    prs: prKeys.join(', '),
  })
}
