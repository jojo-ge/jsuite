// Create an architecture-review project — one per scan, never reused (a fresh
// run is a fresh project; reconciling candidates across scans is deliberately
// not attempted). Body: { repo }. Creates the architect-mode project plus its
// arch:scan ticket, whose herdr dispatch (/jarchitect-scan TICK-n) explores the
// repo and fills the board with HITL arch:candidate tickets. The client
// dispatches the scan itself — this endpoint only builds the machinery, so an
// agent driving the HTTP API can do the same.
export default defineEventHandler(async (event) => {
  const body = await readBody<{ repo?: string }>(event)
  const probe = await probeRepo(String(body?.repo ?? ''))
  if (!probe.ok) throw createError({ statusCode: 400, statusMessage: `${probe.error}: ${probe.path}` })

  const store = loadStore()
  const name = probe.path.split('/').filter(Boolean).pop() || probe.path
  const ts = now()
  const project: Project = {
    id: newId('proj'),
    key: nextKey(store, 'project'),
    title: `Architecture: ${name}`,
    description: [
      `Architecture review of \`${probe.path}\` — deepening opportunities surfaced by \`/jarchitect-scan\`.`,
      '',
      'How this project works:',
      '1. The scan ticket (label `arch:scan`) runs `/jarchitect-scan` in herdr: it explores the repo for deepening opportunities, publishes the assessment spec on this project, and creates one HITL `arch:candidate` ticket per candidate, tagged `arch:strong` / `arch:worth-exploring` / `arch:speculative` (one `arch:top-pick`).',
      '2. Grill a candidate with its herdr button (`/jarchitect-grill`): a jGrilling browser interview that stress-tests that one candidate. Dispatching the grilling IS the triage decision — the ticket moves to done.',
      "3. The grilling hardens the candidate into an implementation-ready spec doc on this project; kick off whatever comes next from that spec.",
      '',
      'No branches, no PRs — the outputs are tickets, docs, and CONTEXT.md/ADR updates in the repo.',
    ].join('\n'),
    mode: 'architect',
    repo: probe.path,
    integrationBranch: '',
    starred: false,
    createdAt: ts,
    updatedAt: ts,
  }
  store.projects.push(project)

  const ticket: Ticket = {
    id: newId('tick'),
    key: nextKey(store, 'ticket'),
    title: `Scan ${name} for deepening opportunities`,
    description: [
      `Architecture scan of \`${probe.path}\`.`,
      '',
      'Explore the codebase for deepening opportunities — refactors that turn shallow modules into deep ones. Publish the assessment as a spec doc on this project and create one HITL `arch:candidate` ticket per candidate, rich enough to grill cold. The `/jarchitect-scan` skill carries the full contract.',
    ].join('\n'),
    acceptanceCriteria: [
      'An assessment spec doc labelled `arch:assessment` is published on the project',
      'One HITL `arch:candidate` ticket exists per candidate, each tagged with a strength label (exactly one `arch:top-pick`)',
      'This ticket is resolved with the candidate list and the doc key',
    ],
    type: 'AFK',
    status: 'todo',
    projectId: project.id,
    assignee: '',
    labels: ['arch', 'arch:scan'],
    resolution: '',
    blockedBy: [],
    comments: [],
    branch: '',
    completedAt: null,
    createdAt: ts,
    updatedAt: ts,
  }
  store.tickets.push(ticket)

  rememberRepo(store, { path: probe.path, slug: probe.slug ?? '', defaultBranch: probe.defaultBranch })
  saveStore(store)
  setResponseStatus(event, 201)
  return { project, ticket }
})
