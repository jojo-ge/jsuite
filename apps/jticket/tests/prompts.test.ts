import { describe, expect, it } from 'vitest'
import { PROMPT_KINDS as SERVER_KINDS } from '../server/utils/prompts'
import {
  PROMPT_GROUPS,
  PROMPT_KIND_META,
  PROMPT_KINDS,
  promptKindFor,
  promptKindsInGroup,
  promptTemplateFor,
  renderPrompt,
  resolveConnectPrompt,
  resolveKickoffPrompt,
  resolveMergePrompt,
  resolveTicketPrompt,
  TICKET_PROMPT_KINDS,
  ticketPromptVars,
  worktreeGuideUrl,
  type PromptOverrides,
} from '../app/utils/prompts'
import type { Project, Ticket } from '../app/composables/useTracker'

// The prompt layering is the whole feature: which kind a hand-off is, which of
// the four layers answers for it, and — critically — that an unconfigured
// jTicket still fires the exact strings it fired before overrides existed.

const ticket = (over: Partial<Ticket> = {}): Ticket =>
  ({
    id: 't1',
    key: 'TICK-42',
    title: 'Persist the cart',
    description: '',
    acceptanceCriteria: [],
    type: 'task',
    status: 'todo',
    projectId: 'p1',
    assignee: '',
    labels: ['afk'],
    resolution: '',
    blockedBy: [],
    comments: [],
    branch: '',
    prompt: '',
    promptMode: '',
    completedAt: null,
    origin: '',
    owner: '',
    transfer: '',
    transferAt: '',
    createdAt: '',
    updatedAt: '',
    ...over,
  }) as Ticket

const project = (over: Partial<Project> = {}): Project =>
  ({
    id: 'p1',
    key: 'PROJ-1',
    title: 'Checkout',
    description: '',
    mode: 'standard',
    repo: '~/code/checkout',
    integrationBranch: 'proj-1-integration',
    starred: false,
    share: null,
    prompts: {},
    createdAt: '',
    updatedAt: '',
    ...over,
  }) as Project

const resolve = (over: {
  ticket?: Partial<Ticket>
  project?: Partial<Project>
  mode?: Project['mode']
  target?: 'local' | 'master' | 'integration'
  defaults?: PromptOverrides
  codebase?: { prompts: PromptOverrides }
  branch?: string
} = {}) =>
  resolveTicketPrompt({
    ticket: ticket(over.ticket),
    project: project(over.project),
    mode: over.mode ?? 'standard',
    target: over.target ?? 'local',
    defaults: over.defaults ?? {},
    codebase: over.codebase,
    branch: over.branch,
  })

describe('the two PROMPT_KINDS lists', () => {
  // The server stores what the client renders; a kind on one side and not the
  // other is silently dropped on save, which is the worst possible failure.
  it('agree, kind for kind', () => {
    expect([...PROMPT_KINDS].sort()).toEqual([...SERVER_KINDS].sort())
  })

  it('every kind has meta, and every group holds at least one kind', () => {
    for (const kind of PROMPT_KINDS) expect(PROMPT_KIND_META[kind]?.template).toBeTruthy()
    for (const group of PROMPT_GROUPS) expect(promptKindsInGroup(group).length).toBeGreaterThan(0)
    expect(PROMPT_KINDS.every((k) => PROMPT_GROUPS.includes(PROMPT_KIND_META[k].group as never))).toBe(true)
  })
})

describe('promptKindFor', () => {
  it('follows the hand-off picker in standard mode', () => {
    expect(promptKindFor('standard', { labels: [] }, 'local')).toBe('standard:local')
    expect(promptKindFor('standard', { labels: [] }, 'master')).toBe('standard:master')
    expect(promptKindFor('standard', { labels: [] }, 'integration')).toBe('standard:integration')
  })

  it('ignores the picker everywhere else', () => {
    expect(promptKindFor('wayfinder', { labels: [] }, 'master')).toBe('wayfinder')
    expect(promptKindFor('todo', { labels: [] }, 'master')).toBe('todo')
    expect(promptKindFor('predeploy', { labels: [] }, 'master')).toBe('predeploy')
  })

  it("reads a jMap ticket's label", () => {
    expect(promptKindFor('jmap', { labels: ['jmap:scope'] }, 'local')).toBe('jmap:scope')
    expect(promptKindFor('jmap', { labels: ['jmap:synthesize'] }, 'local')).toBe('jmap:synthesize')
    expect(promptKindFor('jmap', { labels: [] }, 'local')).toBe('jmap:domain')
  })

  it('splits an architect board into the scan and its candidates', () => {
    expect(promptKindFor('architect', { labels: ['arch:scan'] }, 'local')).toBe('architect:scan')
    expect(promptKindFor('architect', { labels: ['arch:candidate'] }, 'local')).toBe('architect:grill')
  })
})

describe('the built-in prompts', () => {
  // These are the strings jTicket fired before overrides existed. If one of
  // them changes, an unconfigured install starts saying something new.
  it('is the local-PR hand-off, with and without a branch', () => {
    expect(resolve().text).toBe(
      '/jimplement TICK-42 in a worktree. When done open a LOCAL PR in jTicket (POST /api/prs) — no push, no GitHub — and tear down the worktree.',
    )
    expect(resolve({ branch: 'tick-42-cart' }).text).toBe(
      '/jimplement TICK-42 in a worktree on the existing branch tick-42-cart. When done open a LOCAL PR in jTicket (POST /api/prs) — no push, no GitHub — and tear down the worktree.',
    )
  })

  it('is the master and integration hand-offs', () => {
    expect(resolve({ target: 'master' }).text).toBe(
      '/jimplement TICK-42 in a worktree. When done open a PR to master and tear down the worktree.',
    )
    expect(resolve({ target: 'integration' }).text).toBe(
      '/jimplement TICK-42 in a worktree and open a PR to the integration branch. When done tear down the worktree.',
    )
  })

  it('is the bare command in wayfinder, jMap, architect and predeploy mode', () => {
    expect(resolve({ mode: 'wayfinder' }).text).toBe('/jwayfinder TICK-42')
    expect(resolve({ mode: 'jmap', ticket: { labels: ['jmap:scope'] } }).text).toBe('/jmap-scope TICK-42')
    expect(resolve({ mode: 'jmap' }).text).toBe('/jmap-domain TICK-42')
    expect(resolve({ mode: 'architect', ticket: { labels: ['arch:scan'] } }).text).toBe('/jarchitect-scan TICK-42')
    expect(resolve({ mode: 'architect' }).text).toBe('/jarchitect-grill TICK-42')
    expect(resolve({ mode: 'predeploy' }).text).toBe('/jreproduce TICK-42')
  })

  it("is the todo grilling, naming the ticket's key and title", () => {
    expect(resolve({ mode: 'todo' }).text).toBe(
      'Grill me about this todo — TICK-42: "Persist the cart". Read the ticket first ' +
        '(GET http://localhost:43000/api/tickets/TICK-42), then run /grilling here in the terminal — ' +
        'I answer in this pane. Only if I ask for one question in the browser, escalate that ' +
        'single question with /j-grilling. When the grilling finishes, write the decisions into ' +
        "TICK-42's resolution. No branch, no PR.",
    )
  })

  it('is the merge sweep', () => {
    expect(resolveMergePrompt(project(), ['PR-3', 'PR-4'], {})).toBe(
      "Merge PROJ-1's open local jTicket PRs into its integration branch proj-1-integration, oldest first: PR-3, PR-4. " +
        'For each one: POST http://localhost:43000/api/prs/<key>/merge. ' +
        "On a 409 conflict: in the repo at ~/code/checkout, rebase that PR's head branch onto proj-1-integration, " +
        "resolve the conflicts preserving both sides' intent, then POST the merge again. " +
        'Everything stays local — do not push or touch GitHub.',
    )
  })

  it('leaves the sweep\'s literal <key> alone — it is not a placeholder', () => {
    expect(resolveMergePrompt(project(), ['PR-3'], {})).toContain('/api/prs/<key>/merge')
  })
})

describe('the layers', () => {
  it('falls through to the built-in when nothing overrides', () => {
    const r = resolve()
    expect(r.layer).toBe('built-in')
    expect(r.custom).toBe(false)
  })

  it('prefers the global default over the built-in', () => {
    const r = resolve({ defaults: { 'standard:local': 'go build {key}' } })
    expect(r.text).toBe('go build TICK-42')
    expect(r.layer).toBe('default')
    expect(r.custom).toBe(true)
  })

  it("prefers the project's override over the global default", () => {
    const r = resolve({
      project: { prompts: { 'standard:local': 'PROJ way: {key}' } },
      defaults: { 'standard:local': 'go build {key}' },
    })
    expect(r.text).toBe('PROJ way: TICK-42')
    expect(r.layer).toBe('project')
  })

  it('only overrides the kind it names', () => {
    const defaults: PromptOverrides = { 'standard:master': 'master only {key}' }
    expect(resolve({ defaults, target: 'master' }).text).toBe('master only TICK-42')
    expect(resolve({ defaults, target: 'local' }).layer).toBe('built-in')
  })

  it('appends a ticket\'s extras after the resolved prompt', () => {
    const r = resolve({
      ticket: { prompt: 'Skip the changelog.', promptMode: 'append' },
      project: { prompts: { 'standard:local': 'build {key}' } },
    })
    expect(r.text).toBe('build TICK-42\n\nSkip the changelog.')
    expect(r.ticketMode).toBe('append')
  })

  it("replaces the resolved prompt with a ticket's own", () => {
    const r = resolve({
      ticket: { prompt: 'Just look at {key} and report back.', promptMode: 'replace' },
      project: { prompts: { 'standard:local': 'build {key}' } },
    })
    expect(r.text).toBe('Just look at TICK-42 and report back.')
    expect(r.ticketMode).toBe('replace')
    expect(r.custom).toBe(true)
  })

  it('ignores ticket text while the mode is off, and a mode with no text', () => {
    expect(resolve({ ticket: { prompt: 'a draft I have not turned on', promptMode: '' } }).custom).toBe(false)
    expect(resolve({ ticket: { prompt: '   ', promptMode: 'replace' } }).text).toContain('/jimplement TICK-42')
  })

  it('renders placeholders in the ticket\'s own text too', () => {
    expect(
      resolve({
        ticket: { prompt: 'Work in {repo} off {integrationBranch}.', promptMode: 'append' },
        branch: 'tick-42-cart',
      }).text.endsWith('Work in ~/code/checkout off proj-1-integration.'),
    ).toBe(true)
  })

  it('lets a project override the merge sweep', () => {
    expect(resolveMergePrompt(project({ prompts: { merge: 'land {prs} on {integrationBranch}' } }), ['PR-1'], {})).toBe(
      'land PR-1 on proj-1-integration',
    )
  })
})

describe('renderPrompt', () => {
  it('leaves an unknown placeholder standing rather than blanking it', () => {
    expect(renderPrompt('{key} then {nonsense}', ticketPromptVars(ticket(), project()))).toBe('TICK-42 then {nonsense}')
  })

  it('substitutes every occurrence', () => {
    expect(renderPrompt('{key} {key} {key}', ticketPromptVars(ticket(), project()))).toBe('TICK-42 TICK-42 TICK-42')
  })

  it('renders an empty var as empty, not as the placeholder', () => {
    expect(renderPrompt('a{onBranch}b', ticketPromptVars(ticket(), project()))).toBe('ab')
  })
})

describe('promptTemplateFor', () => {
  it('treats a missing project as no override', () => {
    expect(promptTemplateFor('wayfinder', null, {}).layer).toBe('built-in')
    expect(promptTemplateFor('wayfinder', null, { wayfinder: 'x' }).layer).toBe('default')
  })
})

describe('the codebase layer', () => {
  const codebase = { prompts: { 'standard:local': 'codebase {key}' } as PromptOverrides }

  it('sits between the project and the global default', () => {
    const defaults = { 'standard:local': 'global {key}' }
    expect(resolve({ defaults, codebase })).toMatchObject({ text: 'codebase TICK-42', layer: 'codebase', custom: true })
    expect(resolve({ defaults, codebase, project: { prompts: { 'standard:local': 'project {key}' } } }).layer).toBe('project')
    expect(resolve({ defaults, codebase: { prompts: {} } }).layer).toBe('default')
  })

  it('is skipped when absent, so the old three-argument call is unchanged', () => {
    expect(promptTemplateFor('wayfinder', null, {}, null).layer).toBe('built-in')
    expect(promptTemplateFor('wayfinder', null, {}, { prompts: { wayfinder: 'x' } })).toEqual({ template: 'x', layer: 'codebase' })
  })

  it('reaches the project-level sweep too', () => {
    expect(resolveMergePrompt(project(), ['PR-1'], {}, { prompts: { merge: 'land {prs}' } })).toBe('land PR-1')
  })
})

describe('worktree prompts', () => {
  it('are not ticket kinds', () => {
    expect(TICKET_PROMPT_KINDS).not.toContain('worktree:kickoff')
    expect(TICKET_PROMPT_KINDS).not.toContain('worktree:connect')
    expect(TICKET_PROMPT_KINDS).not.toContain('merge')
    expect(PROMPT_KIND_META['worktree:kickoff'].level).toBe('codebase')
  })

  it('are one line — herdr submits a newline early', () => {
    expect(PROMPT_KIND_META['worktree:kickoff'].template).not.toContain('\n')
    expect(PROMPT_KIND_META['worktree:connect'].template).not.toContain('\n')
  })

  it("point the kickoff at the codebase's guide, to read and to write", () => {
    const text = resolveKickoffPrompt({ path: '/code/checkout', prompts: {} }, {})
    const url = worktreeGuideUrl('/code/checkout')
    expect(url).toBe('http://localhost:43000/api/repos/worktree?repo=%2Fcode%2Fcheckout')
    expect(text).toContain(`GET ${url}`)
    expect(text).toContain(`PUT ${url}`)
    expect(text).toContain('/code/checkout')
    expect(text).not.toMatch(/\{\w+\}/)
  })

  it('let a codebase override its own kickoff, but no project can', () => {
    expect(resolveKickoffPrompt({ path: '/r', prompts: { 'worktree:kickoff': 'ask {repo}' } }, { 'worktree:kickoff': 'global' })).toBe('ask /r')
  })

  it("render the connect prompt with the project's branch, its link endpoint and the guide", () => {
    const text = resolveConnectPrompt({ ...project(), repoPath: '/Users/me/code/checkout' }, {})
    expect(text).toContain('proj-1-integration')
    expect(text).toContain('POST http://localhost:43000/api/projects/PROJ-1/worktree')
    expect(text).toContain(worktreeGuideUrl('/Users/me/code/checkout'))
    expect(text).not.toMatch(/\{\w+\}/)
  })

  it('expose the guide URL to ticket templates as {worktreeGuide}', () => {
    expect(ticketPromptVars(ticket(), project()).worktreeGuide).toBe(worktreeGuideUrl('~/code/checkout'))
    expect(ticketPromptVars(ticket(), null).worktreeGuide).toBe('')
  })
})
