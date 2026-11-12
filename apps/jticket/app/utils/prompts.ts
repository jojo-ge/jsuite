// The hand-off prompts, and the four layers that decide which text gets fired.
//
// jTicket's whole agent hand-off is one string: the prompt pasted into a herdr
// pane (or copied to the clipboard). Which string that is resolves through
// five layers, each falling back to the one under it:
//
//   1. the ticket's own text          ticket.prompt + ticket.promptMode
//   2. the project's override         project.prompts[kind]
//   3. the codebase's override        repo.prompts[kind]  (codebase settings)
//   4. the editable global default    GET/PATCH /api/prompts
//   5. the code default               PROMPT_KIND_META[kind].template  ← here
//
// Layers 2–5 are templates rendered with the ticket's/project's values (see
// PROMPT_VARS); layer 1 either appends to or replaces the result. With nothing
// overridden anywhere, every prompt is byte-identical to what jTicket fired
// before overrides existed — the code defaults below ARE the old literals.
//
// The client twin of server/utils/prompts.ts (which owns storage and the same
// PROMPT_KINDS list); tests/prompts.test.ts holds the two lists together.

import type { Project, ProjectMode, Ticket } from '../composables/useTracker'

export const PROMPT_KINDS = [
  'standard:local',
  'standard:master',
  'standard:integration',
  'standard:decision',
  'batch',
  'plan',
  'todo',
  'predeploy',
  'merge',
  'worktree:kickoff',
  'worktree:connect',
  'runplan:build',
  'ticketplan:build',
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
  /** The codebase's worktree guide on jTicket's API — GET it to read, PUT it to write. */
  worktreeGuide: string
  /** A batch's tickets in run order, e.g. 'TICK-3, TICK-4'. */
  keys: string
  /** A batch's per-ticket hand-offs, numbered, each the text that ticket would fire on its own. */
  handoffs: string
}

/** The variables a given kind's editor advertises, in the order they read best. */
const TICKET_VARS = ['key', 'title', 'branch', 'onBranch', 'projectKey', 'projectTitle', 'repo', 'integrationBranch', 'worktreeGuide'] as const
const MERGE_VARS = ['prs', 'projectKey', 'projectTitle', 'repo', 'integrationBranch', 'worktreeGuide'] as const
const KICKOFF_VARS = ['repo', 'worktreeGuide'] as const
const CONNECT_VARS = ['projectKey', 'projectTitle', 'repo', 'integrationBranch', 'worktreeGuide'] as const
const BUILD_PLAN_VARS = ['projectKey', 'projectTitle', 'repo', 'integrationBranch', 'worktreeGuide'] as const
const TICKET_PLAN_VARS = ['projectKey', 'projectTitle', 'repo'] as const
const BATCH_VARS = ['keys','handoffs', 'projectKey', 'projectTitle', 'repo', 'integrationBranch', 'worktreeGuide'] as const

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
  worktreeGuide: "the codebase's worktree guide URL on jTicket's API — GET to read, PUT to write",
  keys: "the batch's tickets in run order, e.g. 'TICK-3, TICK-4'",
  handoffs: "the batch's hand-offs, numbered — each ticket's own prompt, as it would fire alone",
}

/** Where a codebase's worktree guide lives on jTicket's API (repo = path, ~/… or slug). */
export function worktreeGuideUrl(repo: string): string {
  return repo ? `http://localhost:43000/api/repos/worktree?repo=${encodeURIComponent(repo)}` : ''
}

export interface PromptKindMeta {
  /** What the editor calls it. */
  label: string
  /** Why it fires — one line under the label. */
  hint: string
  /** The heading it sits under in the editor. */
  group: string
  /**
   * The narrowest thing that fires it: a ticket (every layer applies), a
   * project (no ticket text), or a codebase (no project either — the project
   * editor doesn't offer it).
   */
  level: 'ticket' | 'project' | 'codebase'
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
    hint: 'Tickets in a build project, with the hand-off picker set to a local PR.',
    group: 'Build',
    level: 'ticket',
    command: '/jimplement',
    vars: TICKET_VARS,
    template:
      '/jimplement {key} in a worktree{onBranch}. Commit, then open a LOCAL PR in jTicket (POST /api/prs) — no push, no GitHub — and only once the PR exists and the work is complete mark the ticket done; then tear down the worktree.',
  },
  'standard:master': {
    label: 'PR to master',
    hint: 'Tickets in a build project, with the hand-off picker set to master.',
    group: 'Build',
    level: 'ticket',
    command: '/jimplement',
    vars: TICKET_VARS,
    template: '/jimplement {key} in a worktree. When done open a PR to master and tear down the worktree.',
  },
  'standard:integration': {
    label: 'PR to integration branch',
    hint: "Tickets in a build project, with the hand-off picker set to the project's integration branch.",
    group: 'Build',
    level: 'ticket',
    command: '/jimplement',
    vars: TICKET_VARS,
    template:
      '/jimplement {key} in a worktree and open a PR to the integration branch. When done tear down the worktree.',
  },
  // A HITL decision ticket on a standard board: there is no code to write, so
  // the hand-off picker doesn't apply — the session interviews the human in
  // its herdr pane and records what was decided. No branch is cut for it.
  'standard:decision': {
    label: 'Decision grilling',
    hint: 'A HITL decision ticket in a build project — an interview in the herdr terminal, whatever the hand-off picker says.',
    group: 'Build',
    level: 'ticket',
    command: '/grilling',
    vars: TICKET_VARS,
    template:
      'Grill me to settle this decision — {key}: "{title}". Read the ticket first ' +
      '(GET http://localhost:43000/api/tickets/{key}) and look up the facts it turns on yourself, ' +
      'then run /grilling here in the terminal — I answer in this pane. When the grilling finishes, ' +
      "write the decisions into {key}'s resolution and mark it done. No branch, no PR.",
  },
  // The board's "One session" button: the ticked tickets, worked one after
  // another by a single claude session in its own tab. Not the orchestrator —
  // no subagents, no claims, no budget — just one agent draining a short list
  // of small tasks or decisions that don't each deserve a model of their own.
  // {handoffs} carries each ticket's OWN resolved prompt (its mode, the
  // hand-off picker's PR target, its project/codebase/ticket overrides), so
  // the batch changes who runs the work, never what each ticket asks for.
  batch: {
    label: 'One session (several tickets)',
    hint: "The board's One session button — the ticked tickets worked in order by a single session, each on its own hand-off.",
    group: 'Build',
    level: 'project',
    command: 'One session',
    vars: BATCH_VARS,
    template: [
      'Work these {projectKey} tickets in this one session, one after another, in this order: {keys}.',
      'No subagents and nothing in parallel: finish each ticket completely — its outcome recorded on it, its status updated, any PR its hand-off asks for opened — before starting the next, then move straight on without stopping to ask.',
      'A HITL ticket is the one exception: put its questions to me here in this pane and wait for my answers.',
      "Each ticket's hand-off, which you follow as written when its turn comes: {handoffs}",
    ].join(' '),
  },
  plan: {
    label: 'Plan ticket',
    hint: 'Every ticket in a plan project — research, prototypes, grillings.',
    group: 'Plan',
    level: 'ticket',
    command: '/jplan',
    vars: TICKET_VARS,
    template: '/jplan {key}',
  },
  todo: {
    label: 'Todo grilling',
    hint: "A todo-list ticket's interview, run in the herdr terminal.",
    group: 'Todo',
    level: 'ticket',
    command: '/grilling',
    vars: TICKET_VARS,
    template:
      'Grill me about this todo — {key}: "{title}". Read the ticket first ' +
      '(GET http://localhost:43000/api/tickets/{key}), then run /grilling here in the terminal — ' +
      'I answer in this pane. When the grilling finishes, write the decisions into ' +
      "{key}'s resolution. No branch, no PR.",
  },
  predeploy: {
    label: 'Pre-deploy reproduction',
    hint: 'Every ticket in a predeploy project — one suspected bug reproduced, never fixed.',
    group: 'Predeploy',
    level: 'ticket',
    command: '/jreproduce',
    vars: TICKET_VARS,
    template: '/jreproduce {key}',
  },
  merge: {
    label: 'Merge sweep',
    hint: "The project-level sweep that lands every open local PR. Not a ticket — no per-ticket override.",
    group: 'Merge',
    level: 'project',
    command: 'Merge sweep',
    vars: MERGE_VARS,
    template: [
      "Merge {projectKey}'s open local jTicket PRs into its integration branch {integrationBranch}, oldest first: {prs}.",
      'For each one: POST http://localhost:43000/api/prs/<key>/merge.',
      "On a 409 conflict: in the repo at {repo}, rebase that PR's head branch onto {integrationBranch}, resolve the conflicts preserving both sides' intent, then POST the merge again.",
      "Once a PR has landed its head branch is done with: if the merge answer names a headWorktree (the branch was still checked out somewhere), tear that worktree down the way the codebase's worktree guide says (GET {worktreeGuide}; with no guide, git worktree remove --force from {repo}) and delete the branch — uncommitted leftovers in a merged worktree are disposable. Never touch the worktree {integrationBranch} itself is checked out in, or any worktree whose branch has not merged.",
      'Everything stays local — do not push or touch GitHub.',
    ].join(' '),
  },
  // One line each, like every template: herdr submits the prompt as typed
  // input, so a newline would send it early.
  'worktree:kickoff': {
    label: 'Worktree kickoff',
    hint: "Asks the codebase how it creates, sets up, runs and tears down worktrees — its answer is the guide every worktree follows.",
    group: 'Worktrees',
    level: 'codebase',
    command: 'Worktree kickoff',
    vars: KICKOFF_VARS,
    template: [
      'Work out how this codebase ({repo}) should do git worktrees, and record the answer in jTicket as its worktree guide.',
      'If a guide exists already (GET {worktreeGuide}), start from it and update what changed.',
      'Read CLAUDE.md/AGENTS.md, the README, package manifests and lockfiles, env examples, docker/compose files, and any worktree scripts or conventions the repo already has — prefer those over inventing new ones.',
      'The guide is markdown for agents and must cover, for a new worktree of a branch: where it goes and the exact create command; setup (dependencies, env files and secrets to copy from the main checkout, codegen, databases); how two worktrees running at once avoid colliding (ports, containers, data); how to run and test it; how to keep it current with its base; and teardown.',
      "Agents mostly only run tests, lint and typecheck, so make the CHEAPEST form that can do that the default (a slim/test-only mode, a shared store, no app or browser stack), say when a full form is needed instead, and how a pooled worktree is reused for ticket after ticket (detached HEAD, switch branches, re-sync deps). Teardown must say the one command that removes a worktree of any kind, that uncommitted leftovers in a worktree whose branch has merged are disposable (--force), and how to find and remove worktrees left behind whose branch has merged into a given branch — jTicket's merge sweep runs that after every merge.",
      "Ask me in this pane for anything the repo can't tell you (secrets, services, port ranges) — don't guess.",
      'Then prove it: create a throwaway worktree the guide\'s way, set it up, run the tests (or the smallest meaningful check), and tear it down.',
      'Record it: PUT {worktreeGuide} with JSON {"body": "<the guide>", "root": "<absolute directory worktrees go under, or empty if no convention>", "sources": ["<repo-relative files the guide rests on — lockfiles, CLAUDE.md, compose files…>"], "verified": <true only if the proof passed>, "author": "claude"}.',
      "Don't commit or change tracked files unless I agree.",
    ].join(' '),
  },
  'worktree:connect': {
    label: 'Connect integration worktree',
    hint: "The integration branch's Connect button — checks the branch out in a worktree the codebase's way and records the link.",
    group: 'Worktrees',
    level: 'project',
    command: 'Connect worktree',
    vars: CONNECT_VARS,
    template: [
      "Connect {projectKey} ({projectTitle})'s integration branch {integrationBranch} to this codebase's worktree setup.",
      "Read the guide first — GET {worktreeGuide} — and follow it; if there isn't one, stop and tell me.",
      'In {repo}: if {integrationBranch} is already checked out in a worktree (git worktree list), adopt that one; otherwise create a worktree for it exactly as the guide says (not the main checkout, not a detached HEAD).',
      'Set it up per the guide and check it runs.',
      'Leave it clean — no untracked files outside .gitignore — because jTicket squash-merges local PRs into this branch and resets this checkout to each merge, refusing when it is dirty.',
      "Don't leave servers running unless I ask.",
      'Then record the link: POST http://localhost:43000/api/projects/{projectKey}/worktree with JSON {"path": "<absolute worktree path>", "notes": "<markdown: what you set up, and how to run and test it there>", "author": "claude"}.',
      'Do not push or touch GitHub.',
    ].join(' '),
  },
  'runplan:build': {
    label: 'Build the run plan',
    hint: "The Run setup tab's Build button — one Fable 5.2 session reads the project and writes its run plan. A codebase or project override is where to say \"never Haiku here\" or \"two orchestrators at most\".",
    group: 'Run setup',
    level: 'project',
    command: 'Build run plan',
    vars: BUILD_PLAN_VARS,
    template: [
      "/jrunplan {projectKey} — build {projectKey} ({projectTitle})'s run plan.",
      'Read the project, its docs and every open ticket (GET http://localhost:43000/api/projects/{projectKey}, /api/docs?projectId={projectKey}, /api/tickets?projectId={projectKey}), then the code in {repo} (integration branch {integrationBranch}; worktree guide {worktreeGuide}) to judge what each ticket touches and how heavy it is.',
      'Group related small tickets under orchestrators and give heavy ones their own agent; pick the model and effort per agent to match the work; put merges where later tickets build on earlier ones; place reviews sparingly — a few implement steps and a good number of landed tickets between them, scaled to the project, always one at the end — and a gate only where a human must look.',
      "Record a prediction for every ticket you place (weight, minutes, risk, why — its step's predictions): the run is scored against it.",
      'Save with PUT http://localhost:43000/api/projects/{projectKey}/run-plan until it reports no problems, then POST http://localhost:43000/api/projects/{projectKey}/run-plan/built.',
      "Don't ask questions — nobody is watching this pane.",
    ].join(' '),
  },
  // A plan project's Ticket plan button: one session turns the resolved plan
  // into draft build tickets and a proposed graph shape. It proposes only —
  // the human edits the drafts and approves; nothing is created or started.
  'ticketplan:build': {
    label: 'Draft the ticket plan',
    hint: "A plan project's Ticket plan button — one session writes the spec, drafts the build tickets and proposes the builds and reviews they go into. A codebase or project override is where to say \"keep builds under 400 lines\" or \"always review\".",
    group: 'Plan',
    level: 'project',
    command: '/jplan-to-jtickets',
    vars: TICKET_PLAN_VARS,
    template: [
      "/jplan-to-jtickets {projectKey} — turn the plan {projectKey} ({projectTitle}) into a ticket plan.",
      'Read the map, every resolved ticket and the plan\'s docs (GET http://localhost:43000/api/projects/{projectKey}, /api/docs?projectId={projectKey}), then the code in {repo}.',
      'Write the spec as a doc on {projectKey}, draft the build tickets on {projectKey} with plannedFor set to the proposed build each belongs to, and propose the graph\'s shape: builds sized so a person can review each roll-up PR in one sitting (split a large one into stacked builds), a Review after every build unless it is trivial, and a plan review first when the plan is large or risky.',
      'Propose only — create no build projects and start nothing.',
      'Check GET http://localhost:43000/api/projects/{projectKey}/ticket-plan until its warnings are the ones you mean, then POST http://localhost:43000/api/projects/{projectKey}/ticket-plan/built.',
      "Don't ask questions — nobody is watching this pane.",
    ].join(' '),
  },
}

/** The editor's sections, in the order they render. */
export const PROMPT_GROUPS = ['Build', 'Plan', 'Todo', 'Predeploy', 'Merge', 'Worktrees', 'Run setup'] as const
export function promptKindsInGroup(group: string): PromptKind[] {
  return PROMPT_KINDS.filter((k) => PROMPT_KIND_META[k].group === group)
}

/** The kinds a single ticket can fire. */
export const TICKET_PROMPT_KINDS = PROMPT_KINDS.filter((k) => PROMPT_KIND_META[k].level === 'ticket')

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

/** A project's repo as the API should see it: the resolved path when the tracker derived one. */
function projectRepo(project: (Pick<Project, 'repo'> & { repoPath?: string }) | null | undefined): string {
  return project?.repoPath || project?.repo || ''
}

export function ticketPromptVars(
  ticket: Pick<Ticket, 'key' | 'title'> & { branch?: string },
  project: (Pick<Project, 'key' | 'title' | 'repo' | 'integrationBranch'> & { repoPath?: string }) | null | undefined,
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
    worktreeGuide: worktreeGuideUrl(projectRepo(project)),
    keys: '',
    handoffs: '',
  }
}

// ── Which kind is this hand-off? ────────────────────────────────────────────
// The same branching the dispatch used to do inline: a project's mode picks
// the family.
// Standard mode is the only one the hand-off picker applies to — and there a
// HITL decision ticket skips it: a decision is settled by an interview, not a PR.
// A PR review project has no kind of its own: its tickets are records and are
// never handed off (isRecordOnly in reviewFindings.ts), so what this answers
// for one is never fired.

/** A decision the human has to make: its hand-off is a grilling, and it gets no branch. */
export function isDecisionGrilling(ticket: Pick<Ticket, 'labels'> & { type?: Ticket['type'] }): boolean {
  return ticket.type === 'decision' && ticket.labels.includes('hitl')
}

export function promptKindFor(
  mode: ProjectMode,
  ticket: Pick<Ticket, 'labels'> & { type?: Ticket['type'] },
  target: 'local' | 'master' | 'integration',
): PromptKind {
  if (mode === 'plan') return 'plan'
  if (mode === 'todo') return 'todo'
  if (mode === 'predeploy') return 'predeploy'
  if (isDecisionGrilling(ticket)) return 'standard:decision'
  return `standard:${target}` as PromptKind
}

// ── The layers ──────────────────────────────────────────────────────────────
export type PromptLayer = 'project' | 'codebase' | 'default' | 'built-in'
/** The codebase layer's input — a codebase settings row, or anything carrying its overrides. */
export type CodebasePrompts = { prompts?: PromptOverrides } | null | undefined

/** Layers 2–5: the template this kind resolves to for this project and codebase. */
export function promptTemplateFor(
  kind: PromptKind,
  project: Pick<Project, 'prompts'> | null | undefined,
  defaults: PromptOverrides,
  codebase?: CodebasePrompts,
): { template: string; layer: PromptLayer } {
  const own = project?.prompts?.[kind]
  if (own) return { template: own, layer: 'project' }
  const shared = codebase?.prompts?.[kind]
  if (shared) return { template: shared, layer: 'codebase' }
  const fallback = defaults[kind]
  if (fallback) return { template: fallback, layer: 'default' }
  return { template: PROMPT_KIND_META[kind].template, layer: 'built-in' }
}

export interface ResolvedPrompt {
  kind: PromptKind
  /** The text that actually gets fired. */
  text: string
  /** Which layer supplied the template (before any ticket text). */
  layer: PromptLayer
  /** What the ticket's own text did to it. */
  ticketMode: TicketPromptMode
  /** True when anything but the built-in template alone produced this. */
  custom: boolean
}

/** Every layer, for one ticket's hand-off. */
export function resolveTicketPrompt(input: {
  ticket: Pick<Ticket, 'key' | 'title' | 'labels'> & { type?: Ticket['type']; branch?: string; prompt?: string; promptMode?: TicketPromptMode }
  project: (Pick<Project, 'key' | 'title' | 'repo' | 'integrationBranch' | 'prompts'> & { repoPath?: string }) | null | undefined
  mode: ProjectMode
  target: 'local' | 'master' | 'integration'
  defaults: PromptOverrides
  /** The project's codebase settings — the layer between project and global. */
  codebase?: CodebasePrompts
  /** The branch as of this hand-off — the dispatch cuts it just before asking. */
  branch?: string
}): ResolvedPrompt {
  const { ticket, project, mode, target, defaults } = input
  const kind = promptKindFor(mode, ticket, target)
  const { template, layer } = promptTemplateFor(kind, project, defaults, input.codebase)
  const vars = ticketPromptVars(ticket, project, input.branch ?? ticket.branch ?? '')

  const own = (ticket.prompt ?? '').trim()
  const ticketMode: TicketPromptMode = own ? (ticket.promptMode ?? '') : ''

  const base = renderPrompt(template, vars)
  const extra = ticketMode ? renderPrompt(own, vars) : ''
  const text = ticketMode === 'replace' ? extra : ticketMode === 'append' ? `${base}\n\n${extra}` : base

  return { kind, text, layer, ticketMode, custom: layer !== 'built-in' || ticketMode !== '' }
}

type ProjectForPrompt = Pick<Project, 'key' | 'title' | 'repo' | 'integrationBranch' | 'prompts'> & { repoPath?: string }

/** The vars of a hand-off with no ticket — a project's, or (project null) a bare codebase's. */
function projectLevelVars(project: ProjectForPrompt | null, repo: string, prs = ''): PromptVars {
  return {
    key: '',
    title: '',
    branch: '',
    onBranch: '',
    projectKey: project?.key ?? '',
    projectTitle: project?.title ?? '',
    repo,
    integrationBranch: project?.integrationBranch ?? '',
    prs,
    worktreeGuide: worktreeGuideUrl(project ? projectRepo(project) : repo),
    keys: '',
    handoffs: '',
  }
}

/** The project-level sweep, resolved through layers 2–5 (it has no ticket). */
export function resolveMergePrompt(
  project: ProjectForPrompt,
  prKeys: string[],
  defaults: PromptOverrides,
  codebase?: CodebasePrompts,
): string {
  const { template } = promptTemplateFor('merge', project, defaults, codebase)
  return renderPrompt(template, projectLevelVars(project, project.repo, prKeys.join(', ')))
}

/** The Run setup tab's Build button — layers 2–5, like the sweep (a project-level hand-off with no ticket). */
export function resolveBuildPlanPrompt(
  project: ProjectForPrompt,
  defaults: PromptOverrides,
  codebase?: CodebasePrompts,
): string {
  const { template } = promptTemplateFor('runplan:build', project, defaults, codebase)
  return renderPrompt(template, projectLevelVars(project, project.repo))
}

/** A plan project's Ticket plan button — layers 2–5, like the run plan's Build (a project-level hand-off with no ticket). */
export function resolveTicketPlanPrompt(
  project: ProjectForPrompt,
  defaults: PromptOverrides,
  codebase?: CodebasePrompts,
): string {
  const { template } = promptTemplateFor('ticketplan:build', project, defaults, codebase)
  return renderPrompt(template, projectLevelVars(project, project.repo))
}

/** One ticket's share of a batch: its key and the prompt it would fire on its own. */
export interface BatchHandoff {
  key: string
  text: string
}

/**
 * The hand-offs as the batch template reads them: numbered, keyed, on one line
 * (herdr submits a newline early). Each text is already resolved through every
 * layer by the caller — the batch never re-renders a ticket's prompt.
 */
export function batchHandoffsText(handoffs: BatchHandoff[]): string {
  const n = handoffs.length
  return handoffs
    .map((h, i) => `[${i + 1}/${n}] ${h.key}: ${h.text.replace(/\s*\n\s*/g, ' ').trim()}`)
    .join(' ')
}

/**
 * The board's One session hand-off — layers 2–5 for the wrapper (a project-
 * level kind), with each ticket's own fully-resolved prompt inlined.
 */
export function resolveBatchPrompt(
  project: ProjectForPrompt,
  handoffs: BatchHandoff[],
  defaults: PromptOverrides,
  codebase?: CodebasePrompts,
): string {
  const { template } = promptTemplateFor('batch', project, defaults, codebase)
  const vars = projectLevelVars(project, project.repo)
  return renderPrompt(template, { ...vars, keys: handoffs.map((h) => h.key).join(', '), handoffs: batchHandoffsText(handoffs) })
}

/** The integration branch's connect prompt — layers 2–5, like the sweep. */
export function resolveConnectPrompt(
  project: ProjectForPrompt,
  defaults: PromptOverrides,
  codebase?: CodebasePrompts,
): string {
  const { template } = promptTemplateFor('worktree:connect', project, defaults, codebase)
  return renderPrompt(template, projectLevelVars(project, project.repo))
}

/** A codebase's worktree kickoff — layers 3–5: there is no project, let alone a ticket. */
export function resolveKickoffPrompt(
  codebase: { path: string; prompts?: PromptOverrides },
  defaults: PromptOverrides,
): string {
  const { template } = promptTemplateFor('worktree:kickoff', null, defaults, codebase)
  return renderPrompt(template, projectLevelVars(null, codebase.path))
}
