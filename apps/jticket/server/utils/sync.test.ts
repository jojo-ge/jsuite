import { describe, it, expect } from 'vitest'
import type { Explainer, DocNotes } from '@jsuite/documents/store'
import type { Project, Ticket, Doc, TicketComment } from './store'
import {
  applySyncSnapshot,
  buildSyncExport,
  type SyncApplyInput,
  type SyncExportInput,
  type SyncSnapshot,
  SYNC_FORMAT,
} from './sync'

// The snapshot sync engine (TICK-293, spec DOC-30). Pure logic — every
// fixture is plain data, no store file, no clock.

// ── Fixtures ────────────────────────────────────────────────────────────────

const AT = '2026-08-24T10:00:00.000Z'

function makeProject(over: Partial<Project> = {}): Project {
  return {
    id: 'proj_local',
    key: 'PROJ-1',
    title: 'Shared effort',
    description: '',
    mode: 'standard',
    repo: '/home/me/code/thing',
    integrationBranch: 'proj/shared-effort',
    starred: true,
    share: { key: 'AB', side: 'creator', peerName: 'sam' },
    createdAt: AT,
    updatedAt: AT,
    ...over,
  }
}

function makeComment(over: Partial<TicketComment> = {}): TicketComment {
  return {
    id: 'cmt_1',
    author: 'me',
    body: 'a comment',
    createdAt: AT,
    origin: 'creator',
    owner: 'creator',
    ...over,
  }
}

function makeTicket(over: Partial<Ticket> = {}): Ticket {
  return {
    id: 'tick_1',
    key: 'AB-1',
    title: 'A ticket',
    description: '',
    acceptanceCriteria: [],
    type: 'AFK',
    status: 'todo',
    projectId: 'proj_local',
    assignee: '',
    labels: [],
    resolution: '',
    blockedBy: [],
    comments: [],
    branch: '',
    completedAt: null,
    origin: 'creator',
    owner: 'creator',
    transfer: '',
    transferAt: '',
    createdAt: AT,
    updatedAt: AT,
    ...over,
  }
}

function makeDoc(over: Partial<Doc> = {}): Doc {
  return {
    id: 'doc_1',
    key: 'DOC-1',
    title: 'A doc',
    documentKey: 'a-doc',
    projectId: 'proj_local',
    labels: [],
    status: 'draft',
    origin: 'creator',
    owner: 'creator',
    createdAt: AT,
    updatedAt: AT,
    ...over,
  }
}

function makeBody(key: string, md = 'hello'): Explainer {
  return { key, title: key, blocks: [{ id: 'b1', type: 'prose', md }] } as unknown as Explainer
}

function exportInput(over: Partial<SyncExportInput> = {}): SyncExportInput {
  return {
    project: makeProject(),
    tickets: [],
    docs: [],
    documents: new Map(),
    exportedAt: AT,
    ...over,
  }
}

// ── buildSyncExport ─────────────────────────────────────────────────────────

describe('buildSyncExport', () => {
  it('refuses a project with no share', () => {
    expect(() => buildSyncExport(exportInput({ project: makeProject({ share: null }) }))).toThrow(/not shared/)
  })

  it('stamps format, version, side, shared key and exportedAt', () => {
    const { snapshot } = buildSyncExport(exportInput())
    expect(snapshot.format).toBe(SYNC_FORMAT)
    expect(snapshot.version).toBe(1)
    expect(snapshot.side).toBe('creator')
    expect(snapshot.sharedKey).toBe('AB')
    expect(snapshot.exportedAt).toBe(AT)
  })

  it('exports only the exporting side\'s owned tickets and docs', () => {
    const { snapshot } = buildSyncExport(exportInput({
      tickets: [
        makeTicket({ id: 'tick_mine', key: 'AB-1', owner: 'creator' }),
        makeTicket({ id: 'tick_theirs', key: 'AB-2', origin: 'importer', owner: 'importer' }),
      ],
      docs: [
        makeDoc({ id: 'doc_mine', owner: 'creator' }),
        makeDoc({ id: 'doc_theirs', key: 'DOC-2', origin: 'importer', owner: 'importer' }),
      ],
    }))
    expect(snapshot.tickets.map((t) => t.id)).toEqual(['tick_mine'])
    expect(snapshot.docs.map((d) => d.record.id)).toEqual(['doc_mine'])
  })

  it('exports unstamped (pre-share) entities stamped with the exporting side', () => {
    const { snapshot } = buildSyncExport(exportInput({
      tickets: [makeTicket({ id: 'tick_old', key: 'TICK-40', origin: '', owner: '' })],
      docs: [makeDoc({ id: 'doc_old', origin: '', owner: '' })],
    }))
    expect(snapshot.tickets[0]).toMatchObject({ id: 'tick_old', origin: 'creator', owner: 'creator' })
    expect(snapshot.docs[0]!.record).toMatchObject({ id: 'doc_old', origin: 'creator', owner: 'creator' })
  })

  it('never carries machine-local fields: repo, integration branch, ticket branches, project ids', () => {
    const { snapshot } = buildSyncExport(exportInput({
      tickets: [makeTicket({ branch: 'tick/AB-1-thing' })],
      docs: [makeDoc()],
    }))
    const text = JSON.stringify(snapshot)
    expect(text).not.toContain('/home/me/code/thing')
    expect(text).not.toContain('proj/shared-effort')
    expect(snapshot.tickets[0]!.branch).toBe('')
    expect(snapshot.tickets[0]!.projectId).toBeNull()
    expect(snapshot.docs[0]!.record.projectId).toBeNull()
  })

  it('keeps only exporter-owned comments on exported tickets', () => {
    const { snapshot } = buildSyncExport(exportInput({
      tickets: [makeTicket({
        comments: [
          makeComment({ id: 'cmt_mine', owner: 'creator' }),
          makeComment({ id: 'cmt_theirs', origin: 'importer', owner: 'importer' }),
          makeComment({ id: 'cmt_old', origin: '', owner: '' }),
        ],
      })],
    }))
    const comments = snapshot.tickets[0]!.comments
    expect(comments.map((c) => c.id)).toEqual(['cmt_mine', 'cmt_old'])
    // The unstamped local comment travels stamped with the exporting side.
    expect(comments[1]).toMatchObject({ origin: 'creator', owner: 'creator' })
  })

  it('collects the exporter\'s comments on peer tickets into peerComments, keyed by ticket id', () => {
    const { snapshot } = buildSyncExport(exportInput({
      tickets: [
        makeTicket({
          id: 'tick_theirs', key: 'AB-2', origin: 'importer', owner: 'importer',
          comments: [
            makeComment({ id: 'cmt_on_theirs', owner: 'creator' }),
            makeComment({ id: 'cmt_their_own', origin: 'importer', owner: 'importer' }),
          ],
        }),
        makeTicket({ id: 'tick_theirs_quiet', key: 'AB-4', origin: 'importer', owner: 'importer' }),
      ],
    }))
    expect(snapshot.peerComments).toEqual([
      { ticketId: 'tick_theirs', comments: [expect.objectContaining({ id: 'cmt_on_theirs' })] },
    ])
  })

  it('exports project metadata from the creator side only', () => {
    const creator = buildSyncExport(exportInput({
      project: makeProject({ title: 'Shared effort', description: 'the plan', mode: 'wayfinder' }),
    }))
    expect(creator.snapshot.projectMeta).toEqual({ title: 'Shared effort', description: 'the plan', mode: 'wayfinder' })

    const importer = buildSyncExport(exportInput({
      project: makeProject({ share: { key: 'AB', side: 'importer', peerName: 'jo' } }),
    }))
    expect(importer.snapshot.projectMeta).toBeNull()
  })

  it('inlines shared-pool bodies from the documents map, null when missing', () => {
    const body = makeBody('a-doc')
    const notes: DocNotes = { notes: [] } as unknown as DocNotes
    const { snapshot } = buildSyncExport(exportInput({
      docs: [makeDoc(), makeDoc({ id: 'doc_2', key: 'DOC-2', documentKey: 'dangling' })],
      documents: new Map([['a-doc', { document: body, documentNotes: notes }]]),
    }))
    expect(snapshot.docs[0]).toMatchObject({ document: body, documentNotes: notes })
    expect(snapshot.docs[1]).toMatchObject({ document: null, documentNotes: null })
  })

  it('sweeps attachment and doc-media refs from every exported text surface', () => {
    const { snapshot, attachmentNames, mediaRefs } = buildSyncExport(exportInput({
      project: makeProject({ description: 'see /attachments/plan.pdf' }),
      tickets: [makeTicket({
        description: '![d](/attachments/diagram.png)',
        comments: [makeComment({ body: '![s](/api/media/a-doc/notes/shot.png)' })],
      })],
      docs: [makeDoc()],
      documents: new Map([['a-doc', { document: makeBody('a-doc', '![x](/api/media/a-doc/arch.png)'), documentNotes: null }]]),
    }))
    expect(snapshot.attachments).toEqual([])
    expect(snapshot.media).toEqual([])
    expect([...attachmentNames].sort()).toEqual(['diagram.png', 'plan.pdf'])
    expect(mediaRefs).toEqual(expect.arrayContaining([
      { docKey: 'a-doc', name: 'shot.png', notes: true },
      { docKey: 'a-doc', name: 'arch.png', notes: false },
    ]))
    expect(mediaRefs).toHaveLength(2)
  })

  it('round-trip: what one side exports, the other side\'s export never contains', () => {
    // Symmetry sanity: each side exports a disjoint half.
    const tickets = [
      makeTicket({ id: 'tick_c', key: 'AB-1', origin: 'creator', owner: 'creator' }),
      makeTicket({ id: 'tick_i', key: 'AB-2', origin: 'importer', owner: 'importer' }),
    ]
    const creator = buildSyncExport(exportInput({ tickets }))
    const importer = buildSyncExport(exportInput({
      project: makeProject({ share: { key: 'AB', side: 'importer', peerName: 'jo' } }),
      tickets,
    }))
    expect(creator.snapshot.tickets.map((t) => t.id)).toEqual(['tick_c'])
    expect(importer.snapshot.tickets.map((t) => t.id)).toEqual(['tick_i'])
  })

  it('does not sweep refs that appear only in peer-owned text', () => {
    const { attachmentNames, mediaRefs } = buildSyncExport(exportInput({
      tickets: [makeTicket({
        id: 'tick_theirs', key: 'AB-2', origin: 'importer', owner: 'importer',
        description: '![d](/attachments/theirs.png) ![m](/api/media/their-doc/pic.png)',
      })],
    }))
    expect(attachmentNames).toEqual([])
    expect(mediaRefs).toEqual([])
  })
})

// ── applySyncSnapshot — core merge rules ────────────────────────────────────
// The receiving side is the creator; snapshots arrive from the importer, whose
// half is the peer-owned set here.

function makeSnapshot(over: Partial<SyncSnapshot> = {}): SyncSnapshot {
  return {
    format: SYNC_FORMAT,
    version: 1,
    exportedAt: AT,
    side: 'importer',
    sharedKey: 'AB',
    projectMeta: null,
    tickets: [],
    peerComments: [],
    transferDeclines: [],
    docs: [],
    attachments: [],
    media: [],
    ...over,
  }
}

// A ticket as the importer side would export it.
function theirTicket(over: Partial<Ticket> = {}): Ticket {
  return makeTicket({ id: 'tick_p1', key: 'AB-2', projectId: null, origin: 'importer', owner: 'importer', ...over })
}

function theirDoc(over: Partial<Doc> = {}): Doc {
  return makeDoc({ id: 'doc_p1', key: 'DOC-9', documentKey: 'their-doc', projectId: null, origin: 'importer', owner: 'importer', ...over })
}

function applyInput(over: Partial<SyncApplyInput> = {}): SyncApplyInput {
  return {
    project: makeProject(),
    tickets: [],
    docs: [],
    counters: { ticket: 5, doc: 3 },
    takenTicketKeys: [],
    takenDocKeys: [],
    existingDocumentKeys: [],
    localDocuments: new Map(),
    localAttachments: new Map<string, string>(),
    snapshot: makeSnapshot(),
    ...over,
  }
}

describe('applySyncSnapshot — guards', () => {
  it('refuses a project with no share', () => {
    expect(() => applySyncSnapshot(applyInput({ project: makeProject({ share: null }) }))).toThrow(/not shared/)
  })

  it('refuses a snapshot from its own side', () => {
    expect(() => applySyncSnapshot(applyInput({ snapshot: makeSnapshot({ side: 'creator' }) }))).toThrow(/side/)
  })

  it('refuses a mismatched shared key and a foreign format', () => {
    expect(() => applySyncSnapshot(applyInput({ snapshot: makeSnapshot({ sharedKey: 'XY' }) }))).toThrow(/key/)
    expect(() => applySyncSnapshot(applyInput({
      snapshot: { ...makeSnapshot(), format: 'jticket-project-bundle' as typeof SYNC_FORMAT },
    }))).toThrow(/snapshot/)
  })
})

describe('applySyncSnapshot — wholesale replace and deletion by absence', () => {
  it('adds a new peer ticket and reports it in the summary', () => {
    const res = applySyncSnapshot(applyInput({
      snapshot: makeSnapshot({ tickets: [theirTicket({ title: 'Their new ticket' })] }),
    }))
    expect(res.tickets).toHaveLength(1)
    expect(res.tickets[0]).toMatchObject({
      id: 'tick_p1',
      key: 'AB-2',
      title: 'Their new ticket',
      projectId: 'proj_local',
      origin: 'importer',
      owner: 'importer',
    })
    expect(res.summary.tickets.added).toEqual(['AB-2'])
    expect(res.summary.tickets.changed).toEqual([])
    expect(res.summary.tickets.deleted).toEqual([])
  })

  it('replaces an existing peer ticket wholesale, matched by id', () => {
    const local = theirTicket({ title: 'Old title', status: 'todo', projectId: 'proj_local' })
    const res = applySyncSnapshot(applyInput({
      tickets: [local],
      snapshot: makeSnapshot({
        tickets: [theirTicket({ title: 'New title', status: 'in_progress', resolution: 'progress' })],
      }),
    }))
    expect(res.tickets).toHaveLength(1)
    expect(res.tickets[0]).toMatchObject({ id: 'tick_p1', title: 'New title', status: 'in_progress', resolution: 'progress' })
    expect(res.summary.tickets.changed).toEqual(['AB-2'])
  })

  it('deletes peer tickets and docs absent from the snapshot', () => {
    const res = applySyncSnapshot(applyInput({
      tickets: [theirTicket({ projectId: 'proj_local' })],
      docs: [theirDoc({ projectId: 'proj_local' })],
      snapshot: makeSnapshot(),
    }))
    expect(res.tickets).toEqual([])
    expect(res.docs).toEqual([])
    expect(res.summary.tickets.deleted).toEqual(['AB-2'])
    expect(res.summary.docs.deleted).toEqual(['DOC-9'])
    expect(res.documentDeletes).toEqual(['their-doc'])
  })

  it('an unchanged peer ticket is not reported as changed', () => {
    const t = theirTicket()
    const res = applySyncSnapshot(applyInput({
      tickets: [{ ...t, projectId: 'proj_local' }],
      snapshot: makeSnapshot({ tickets: [t] }),
    }))
    expect(res.summary.tickets).toEqual({ added: [], changed: [], deleted: [] })
  })

  it('never modifies locally-owned tickets and docs', () => {
    const mine = makeTicket({ id: 'tick_mine', key: 'AB-1', status: 'in_progress', branch: 'tick/AB-1-x' })
    const unstamped = makeTicket({ id: 'tick_old', key: 'TICK-2', origin: '', owner: '' })
    const myDoc = makeDoc({ id: 'doc_mine' })
    const res = applySyncSnapshot(applyInput({
      tickets: [mine, unstamped],
      docs: [myDoc],
      snapshot: makeSnapshot({ tickets: [theirTicket()] }),
    }))
    expect(res.tickets.find((t) => t.id === 'tick_mine')).toEqual(mine)
    expect(res.tickets.find((t) => t.id === 'tick_old')).toEqual(unstamped)
    expect(res.docs.find((d) => d.id === 'doc_mine')).toEqual(myDoc)
    expect(res.summary.tickets.added).toEqual(['AB-2'])
  })

  it('drops incoming entities not owned by the sending side', () => {
    const res = applySyncSnapshot(applyInput({
      snapshot: makeSnapshot({
        tickets: [
          theirTicket({ id: 'tick_evil', key: 'AB-6', owner: 'creator' }),
          theirTicket({ id: 'tick_unstamped', key: 'AB-8', origin: '', owner: '' }),
        ],
      }),
    }))
    expect(res.tickets).toEqual([])
    expect(res.dropped.sort()).toEqual(['AB-6', 'AB-8'])
  })

  it('drops an incoming ticket whose id collides with a locally-owned entity', () => {
    const mine = makeTicket({ id: 'tick_mine', key: 'AB-1' })
    const res = applySyncSnapshot(applyInput({
      tickets: [mine],
      snapshot: makeSnapshot({ tickets: [theirTicket({ id: 'tick_mine', key: 'AB-2' })] }),
    }))
    expect(res.tickets).toEqual([mine])
    expect(res.dropped).toEqual(['AB-2'])
  })

  it('always strips the work branch from incoming tickets', () => {
    const res = applySyncSnapshot(applyInput({
      snapshot: makeSnapshot({ tickets: [theirTicket({ branch: 'tick/AB-2-thing' })] }),
    }))
    expect(res.tickets[0]!.branch).toBe('')
  })

  it('keeps peer blockedBy edges (ids are preserved across machines) minus self-references', () => {
    const res = applySyncSnapshot(applyInput({
      tickets: [makeTicket({ id: 'tick_mine', key: 'AB-1' })],
      snapshot: makeSnapshot({
        tickets: [theirTicket({ blockedBy: ['tick_mine', 'tick_p1', 'tick_mine'] })],
      }),
    }))
    expect(res.tickets.find((t) => t.id === 'tick_p1')!.blockedBy).toEqual(['tick_mine'])
  })
})

describe('applySyncSnapshot — project metadata', () => {
  const importerLocal = makeProject({ share: { key: 'AB', side: 'importer', peerName: 'sam' } })

  it('applies creator metadata on the importer side, leaving machine-local fields alone', () => {
    const res = applySyncSnapshot(applyInput({
      project: importerLocal,
      snapshot: makeSnapshot({
        side: 'creator',
        projectMeta: { title: 'Renamed', description: 'new plan', mode: 'wayfinder' },
      }),
    }))
    expect(res.project).toMatchObject({
      title: 'Renamed',
      description: 'new plan',
      mode: 'wayfinder',
      repo: '/home/me/code/thing',
      integrationBranch: 'proj/shared-effort',
      starred: true,
      share: { key: 'AB', side: 'importer', peerName: 'sam' },
    })
    expect(res.summary.projectChanged).toBe(true)
  })

  it('unchanged metadata does not flag projectChanged', () => {
    const res = applySyncSnapshot(applyInput({
      project: importerLocal,
      snapshot: makeSnapshot({
        side: 'creator',
        projectMeta: { title: importerLocal.title, description: importerLocal.description, mode: importerLocal.mode },
      }),
    }))
    expect(res.summary.projectChanged).toBe(false)
    expect(res.project).toEqual(importerLocal)
  })

  it('ignores project metadata coming from the importer side', () => {
    const local = makeProject()
    const res = applySyncSnapshot(applyInput({
      project: local,
      snapshot: makeSnapshot({ projectMeta: { title: 'Hijack', description: 'x', mode: 'standard' } }),
    }))
    expect(res.project).toEqual(local)
    expect(res.summary.projectChanged).toBe(false)
  })
})

// ── applySyncSnapshot — key mapping, doc pool, media, attachments ───────────
// Ticket parity keys never collide by construction, but doc keys (DOC-n from
// each side's global counter) and pre-share TICK-n keys can — those are
// remapped on apply, stably across pulls.

describe('applySyncSnapshot — ticket key mapping', () => {
  it('drops an incoming parity key that collides with a locally-owned ticket', () => {
    const mine = makeTicket({ id: 'tick_mine', key: 'AB-1' })
    const res = applySyncSnapshot(applyInput({
      tickets: [mine],
      snapshot: makeSnapshot({ tickets: [theirTicket({ id: 'tick_bad', key: 'AB-1' })] }),
    }))
    expect(res.tickets).toEqual([mine])
    expect(res.dropped).toEqual(['AB-1'])
  })

  it('adopts a free non-parity key and bumps the ticket counter past it', () => {
    const res = applySyncSnapshot(applyInput({
      snapshot: makeSnapshot({ tickets: [theirTicket({ key: 'TICK-40' })] }),
    }))
    expect(res.tickets[0]!.key).toBe('TICK-40')
    expect(res.counters.ticket).toBe(40)
  })

  it('mints a fresh local key when a non-parity key is taken', () => {
    const res = applySyncSnapshot(applyInput({
      takenTicketKeys: ['TICK-3'],
      snapshot: makeSnapshot({ tickets: [theirTicket({ key: 'TICK-3' })] }),
    }))
    expect(res.tickets[0]!.key).toBe('TICK-6') // counter was 5
    expect(res.counters.ticket).toBe(6)
    expect(res.summary.tickets.added).toEqual(['TICK-6'])
  })

  it('a remapped key stays stable on later pulls (matched by id)', () => {
    const first = applySyncSnapshot(applyInput({
      takenTicketKeys: ['TICK-3'],
      snapshot: makeSnapshot({ tickets: [theirTicket({ key: 'TICK-3' })] }),
    }))
    const second = applySyncSnapshot(applyInput({
      tickets: first.tickets,
      counters: first.counters,
      takenTicketKeys: ['TICK-3', 'TICK-6'],
      snapshot: makeSnapshot({ tickets: [theirTicket({ key: 'TICK-3' })] }),
    }))
    expect(second.tickets[0]!.key).toBe('TICK-6')
    expect(second.counters.ticket).toBe(6)
    expect(second.summary.tickets).toEqual({ added: [], changed: [], deleted: [] })
  })

  it('a parity key deleted and re-minted in the same pull does not self-collide', () => {
    // The local peer copy of AB-2 dies by absence while a NEW peer ticket
    // arrives with key AB-2 — the peer set is replaced wholesale, so the old
    // copy's key is not an obstacle.
    const res = applySyncSnapshot(applyInput({
      tickets: [theirTicket({ id: 'tick_old_p', projectId: 'proj_local' })],
      takenTicketKeys: ['AB-2'],
      snapshot: makeSnapshot({ tickets: [theirTicket({ id: 'tick_new_p', key: 'AB-2' })] }),
    }))
    expect(res.tickets.map((t) => t.id)).toEqual(['tick_new_p'])
    expect(res.tickets[0]!.key).toBe('AB-2')
  })
})

describe('applySyncSnapshot — doc keys and the shared pool', () => {
  it('adopts free record and pool keys, bumping the doc counter', () => {
    const body = makeBody('their-doc')
    const res = applySyncSnapshot(applyInput({
      snapshot: makeSnapshot({ docs: [{ record: theirDoc(), document: body, documentNotes: null }] }),
    }))
    expect(res.docs[0]).toMatchObject({ key: 'DOC-9', documentKey: 'their-doc' })
    expect(res.counters.doc).toBe(9)
    expect(res.documentWrites).toEqual([{ key: 'their-doc', document: body, documentNotes: null }])
    expect(res.summary.docs.added).toEqual(['DOC-9'])
  })

  it('remaps a colliding record key to a freshly minted DOC-n', () => {
    const res = applySyncSnapshot(applyInput({
      takenDocKeys: ['DOC-9'],
      snapshot: makeSnapshot({ docs: [{ record: theirDoc(), document: makeBody('their-doc'), documentNotes: null }] }),
    }))
    expect(res.docs[0]!.key).toBe('DOC-4') // doc counter was 3
    expect(res.counters.doc).toBe(4)
  })

  it('suffixes a colliding pool key and rewrites media urls everywhere', () => {
    const body = makeBody('notes', '![x](/api/media/notes/arch.png)')
    const res = applySyncSnapshot(applyInput({
      existingDocumentKeys: ['notes'],
      snapshot: makeSnapshot({
        tickets: [theirTicket({ description: 'see ![x](/api/media/notes/arch.png)' })],
        docs: [{ record: theirDoc({ documentKey: 'notes' }), document: body, documentNotes: null }],
        media: [{ docKey: 'notes', name: 'arch.png', notes: false, base64: 'Zm9v' }],
      }),
    }))
    expect(res.docs[0]!.documentKey).toBe('notes-2')
    expect(res.documentWrites).toHaveLength(1)
    expect(res.documentWrites[0]!.key).toBe('notes-2')
    expect(JSON.stringify(res.documentWrites[0]!.document)).toContain('/api/media/notes-2/arch.png')
    expect((res.documentWrites[0]!.document as { key: string }).key).toBe('notes-2')
    expect(res.tickets[0]!.description).toBe('see ![x](/api/media/notes-2/arch.png)')
    expect(res.mediaWrites).toEqual([{ docKey: 'notes-2', name: 'arch.png', notes: false, base64: 'Zm9v' }])
  })

  it('keeps a previously suffixed pool key on later pulls', () => {
    const local = theirDoc({ documentKey: 'notes-2', projectId: 'proj_local' })
    const res = applySyncSnapshot(applyInput({
      docs: [local],
      existingDocumentKeys: ['notes', 'notes-2'],
      localDocuments: new Map([['notes-2', { document: { ...makeBody('notes'), key: 'notes-2' } as Explainer, documentNotes: null }]]),
      snapshot: makeSnapshot({
        docs: [{ record: theirDoc({ documentKey: 'notes' }), document: makeBody('notes'), documentNotes: null }],
      }),
    }))
    expect(res.docs[0]!.documentKey).toBe('notes-2')
    expect(res.documentWrites).toEqual([])
    expect(res.summary.docs).toEqual({ added: [], changed: [], deleted: [] })
  })

  it('two incoming docs wanting the same taken pool key get distinct suffixes', () => {
    const res = applySyncSnapshot(applyInput({
      existingDocumentKeys: ['notes'],
      snapshot: makeSnapshot({
        docs: [
          { record: theirDoc({ id: 'doc_pa', key: 'DOC-11', documentKey: 'notes' }), document: makeBody('notes'), documentNotes: null },
          { record: theirDoc({ id: 'doc_pb', key: 'DOC-13', documentKey: 'notes' }), document: makeBody('notes'), documentNotes: null },
        ],
      }),
    }))
    expect(res.docs.map((d) => d.documentKey).sort()).toEqual(['notes-2', 'notes-3'])
  })

  it('emits a document write only when the body or notes differ locally', () => {
    const body = makeBody('their-doc')
    const unchanged = applySyncSnapshot(applyInput({
      docs: [theirDoc({ projectId: 'proj_local' })],
      existingDocumentKeys: ['their-doc'],
      localDocuments: new Map([['their-doc', { document: body, documentNotes: null }]]),
      snapshot: makeSnapshot({ docs: [{ record: theirDoc(), document: body, documentNotes: null }] }),
    }))
    expect(unchanged.documentWrites).toEqual([])
    expect(unchanged.summary.docs.changed).toEqual([])

    const edited = applySyncSnapshot(applyInput({
      docs: [theirDoc({ projectId: 'proj_local' })],
      existingDocumentKeys: ['their-doc'],
      localDocuments: new Map([['their-doc', { document: body, documentNotes: null }]]),
      snapshot: makeSnapshot({ docs: [{ record: theirDoc(), document: makeBody('their-doc', 'edited'), documentNotes: null }] }),
    }))
    expect(edited.documentWrites).toHaveLength(1)
    expect(edited.summary.docs.changed).toEqual(['DOC-9'])
  })
})

describe('applySyncSnapshot — attachments', () => {
  it('writes a new attachment under its own name', () => {
    const res = applySyncSnapshot(applyInput({
      snapshot: makeSnapshot({ attachments: [{ name: 'plan.pdf', base64: 'Zm9v' }] }),
    }))
    expect(res.attachmentWrites).toEqual([{ name: 'plan.pdf', base64: 'Zm9v' }])
  })

  it('skips an attachment whose local bytes already match', () => {
    const res = applySyncSnapshot(applyInput({
      localAttachments: new Map([['plan.pdf', 'Zm9v']]),
      snapshot: makeSnapshot({ attachments: [{ name: 'plan.pdf', base64: 'Zm9v' }] }),
    }))
    expect(res.attachmentWrites).toEqual([])
  })

  it('renames on a byte mismatch and rewrites incoming urls — stably across pulls', () => {
    const first = applySyncSnapshot(applyInput({
      localAttachments: new Map([['diagram.png', 'bG9jYWw=']]),
      snapshot: makeSnapshot({
        tickets: [theirTicket({ description: '![d](/attachments/diagram.png)' })],
        attachments: [{ name: 'diagram.png', base64: 'cGVlcg==' }],
      }),
    }))
    expect(first.attachmentWrites).toEqual([{ name: 'diagram-2.png', base64: 'cGVlcg==' }])
    expect(first.tickets[0]!.description).toBe('![d](/attachments/diagram-2.png)')

    // Second pull: diagram-2.png now exists locally with the peer's bytes.
    const second = applySyncSnapshot(applyInput({
      tickets: first.tickets,
      localAttachments: new Map([['diagram.png', 'bG9jYWw='], ['diagram-2.png', 'cGVlcg==']]),
      snapshot: makeSnapshot({
        tickets: [theirTicket({ description: '![d](/attachments/diagram.png)' })],
        attachments: [{ name: 'diagram.png', base64: 'cGVlcg==' }],
      }),
    }))
    expect(second.attachmentWrites).toEqual([])
    expect(second.tickets[0]!.description).toBe('![d](/attachments/diagram-2.png)')
    expect(second.summary.tickets).toEqual({ added: [], changed: [], deleted: [] })
  })
})

// ── applySyncSnapshot — per-ticket comment-set merge ────────────────────────
// Each side may comment on any ticket; a pull wholesale-replaces the PEER'S
// comment subset on every ticket and never touches locally-owned comments.

describe('applySyncSnapshot — comment merge', () => {
  const theirComment = (over: Partial<TicketComment> = {}): TicketComment =>
    makeComment({ id: 'cmt_p1', author: 'sam', origin: 'importer', owner: 'importer', ...over })

  it('merges incoming peer comments into a locally-owned ticket, sorted by time', () => {
    const mine = makeTicket({
      id: 'tick_mine', key: 'AB-1',
      comments: [makeComment({ id: 'cmt_mine', createdAt: '2026-08-24T12:00:00.000Z' })],
    })
    const res = applySyncSnapshot(applyInput({
      tickets: [mine],
      snapshot: makeSnapshot({
        peerComments: [{
          ticketId: 'tick_mine',
          comments: [theirComment({ createdAt: '2026-08-24T11:00:00.000Z' })],
        }],
      }),
    }))
    const merged = res.tickets[0]!
    expect(merged.comments.map((c) => c.id)).toEqual(['cmt_p1', 'cmt_mine'])
    // Everything but the comment set is untouched.
    expect({ ...merged, comments: [] }).toEqual({ ...mine, comments: [] })
    expect(res.summary.comments).toEqual({ added: 1, changed: 0, deleted: 0 })
  })

  it('replaces the peer comment subset wholesale: absent deleted, edited changed', () => {
    const mine = makeTicket({
      id: 'tick_mine', key: 'AB-1',
      comments: [
        makeComment({ id: 'cmt_mine' }),
        theirComment({ id: 'cmt_p_stale' }),
        theirComment({ id: 'cmt_p_edited', body: 'old wording' }),
      ],
    })
    const res = applySyncSnapshot(applyInput({
      tickets: [mine],
      snapshot: makeSnapshot({
        peerComments: [{
          ticketId: 'tick_mine',
          comments: [theirComment({ id: 'cmt_p_edited', body: 'new wording' })],
        }],
      }),
    }))
    const ids = res.tickets[0]!.comments.map((c) => c.id).sort()
    expect(ids).toEqual(['cmt_mine', 'cmt_p_edited'])
    expect(res.tickets[0]!.comments.find((c) => c.id === 'cmt_p_edited')!.body).toBe('new wording')
    expect(res.summary.comments).toEqual({ added: 0, changed: 1, deleted: 1 })
  })

  it('keeps my comments on a peer ticket through its wholesale replace', () => {
    const localPeer = theirTicket({
      projectId: 'proj_local',
      comments: [
        makeComment({ id: 'cmt_mine_on_theirs', createdAt: '2026-08-24T12:00:00.000Z' }),
        theirComment({ id: 'cmt_p_old' }),
      ],
    })
    const res = applySyncSnapshot(applyInput({
      tickets: [localPeer],
      snapshot: makeSnapshot({
        tickets: [theirTicket({
          title: 'Retitled',
          comments: [theirComment({ id: 'cmt_p_new', createdAt: '2026-08-24T13:00:00.000Z' })],
        })],
      }),
    }))
    expect(res.tickets[0]!.title).toBe('Retitled')
    expect(res.tickets[0]!.comments.map((c) => c.id)).toEqual(['cmt_mine_on_theirs', 'cmt_p_new'])
    expect(res.summary.comments).toEqual({ added: 1, changed: 0, deleted: 1 })
  })

  it('drops an incoming comment whose id collides with a locally-owned comment', () => {
    const mine = makeTicket({
      id: 'tick_mine', key: 'AB-1',
      comments: [makeComment({ id: 'cmt_shared', body: 'mine' })],
    })
    const res = applySyncSnapshot(applyInput({
      tickets: [mine],
      snapshot: makeSnapshot({
        peerComments: [{ ticketId: 'tick_mine', comments: [theirComment({ id: 'cmt_shared', body: 'theirs' })] }],
      }),
    }))
    expect(res.tickets[0]!.comments).toEqual(mine.comments)
    expect(res.summary.comments).toEqual({ added: 0, changed: 0, deleted: 0 })
  })

  it('ignores peer comments for tickets that do not exist here', () => {
    const res = applySyncSnapshot(applyInput({
      snapshot: makeSnapshot({
        peerComments: [{ ticketId: 'tick_gone', comments: [theirComment()] }],
      }),
    }))
    expect(res.tickets).toEqual([])
    expect(res.summary.comments).toEqual({ added: 0, changed: 0, deleted: 0 })
  })

  it('comments arriving with a brand-new peer ticket count as the ticket, not as comment events', () => {
    const res = applySyncSnapshot(applyInput({
      snapshot: makeSnapshot({ tickets: [theirTicket({ comments: [theirComment()] })] }),
    }))
    expect(res.summary.tickets.added).toEqual(['AB-2'])
    expect(res.summary.comments).toEqual({ added: 0, changed: 0, deleted: 0 })
  })
})

// ── applySyncSnapshot — idempotence ─────────────────────────────────────────

// Simulate the caller having performed the IO plan, then re-pull the same
// snapshot: the state, the summary and the plan must all come back empty.
function afterApply(input: SyncApplyInput, res: ReturnType<typeof applySyncSnapshot>): SyncApplyInput {
  const localAttachments = new Map<string, string>()
  for (const [k, v] of (input.localAttachments as Map<string, string>).entries()) localAttachments.set(k, v)
  for (const w of res.attachmentWrites) localAttachments.set(w.name, w.base64)
  const localDocuments = new Map(input.localDocuments)
  for (const w of res.documentWrites) localDocuments.set(w.key, { document: w.document, documentNotes: w.documentNotes })
  const existingDocumentKeys = new Set(input.existingDocumentKeys)
  for (const w of res.documentWrites) existingDocumentKeys.add(w.key)
  for (const d of res.docs) if (d.documentKey) existingDocumentKeys.add(d.documentKey)
  for (const k of res.documentDeletes) existingDocumentKeys.delete(k)
  return {
    ...input,
    project: res.project,
    tickets: res.tickets,
    docs: res.docs,
    counters: res.counters,
    takenTicketKeys: new Set([...input.takenTicketKeys, ...res.tickets.map((t) => t.key)]),
    takenDocKeys: new Set([...input.takenDocKeys, ...res.docs.map((d) => d.key)]),
    existingDocumentKeys,
    localDocuments,
    localAttachments,
  }
}

const EMPTY_SUMMARY = {
  projectChanged: false,
  tickets: { added: [], changed: [], deleted: [] },
  docs: { added: [], changed: [], deleted: [] },
  comments: { added: 0, changed: 0, deleted: 0 },
}

describe('applySyncSnapshot — idempotence', () => {
  it('applying the same snapshot twice is a no-op', () => {
    const input = applyInput({
      project: makeProject({ share: { key: 'AB', side: 'importer', peerName: 'sam' } }),
      tickets: [
        makeTicket({ id: 'tick_mine', key: 'AB-2', origin: 'importer', owner: 'importer',
          comments: [makeComment({ id: 'cmt_mine', origin: 'importer', owner: 'importer' })] }),
      ],
      takenTicketKeys: ['AB-2', 'TICK-3'],
      takenDocKeys: ['DOC-9'],
      existingDocumentKeys: ['notes'],
      localAttachments: new Map([['diagram.png', 'bG9jYWw=']]),
      snapshot: makeSnapshot({
        side: 'creator',
        projectMeta: { title: 'Renamed', description: 'see /attachments/diagram.png', mode: 'standard' },
        tickets: [
          makeTicket({ id: 'tick_p1', key: 'AB-1', projectId: null, origin: 'creator', owner: 'creator',
            description: '![d](/attachments/diagram.png) and ![m](/api/media/notes/arch.png)',
            comments: [makeComment({ id: 'cmt_p1', origin: 'creator', owner: 'creator' })] }),
          makeTicket({ id: 'tick_p2', key: 'TICK-3', projectId: null, origin: 'creator', owner: 'creator' }),
        ],
        peerComments: [{ ticketId: 'tick_mine', comments: [makeComment({ id: 'cmt_p_on_mine', origin: 'creator', owner: 'creator' })] }],
        docs: [{ record: makeDoc({ id: 'doc_p1', key: 'DOC-9', documentKey: 'notes', projectId: null, origin: 'creator', owner: 'creator' }),
          document: makeBody('notes', '![m](/api/media/notes/arch.png)'), documentNotes: null }],
        attachments: [{ name: 'diagram.png', base64: 'cGVlcg==' }],
        media: [{ docKey: 'notes', name: 'arch.png', notes: false, base64: 'Zm9v' }],
      }),
    })
    const first = applySyncSnapshot(input)
    expect(first.summary.projectChanged).toBe(true)
    expect(first.summary.tickets.added.sort()).toEqual(['AB-1', 'TICK-6']) // counter was 5, TICK-3 taken
    expect(first.summary.comments.added).toBe(1)

    const second = applySyncSnapshot(afterApply(input, first))
    expect(second.summary).toEqual(EMPTY_SUMMARY)
    expect(second.documentWrites).toEqual([])
    expect(second.attachmentWrites).toEqual([])
    expect(second.documentDeletes).toEqual([])
    expect(second.dropped).toEqual([])
    expect(JSON.stringify({ p: second.project, t: second.tickets, d: second.docs, c: second.counters }))
      .toBe(JSON.stringify({ p: first.project, t: first.tickets, d: first.docs, c: first.counters }))
  })
})

// ── applySyncSnapshot — properties over randomized states ───────────────────
// A tiny seeded generator (no PRNG deps): whatever the snapshot holds, apply
// never modifies locally-owned entities, everything peer-owned in the result
// belongs to the peer, and a second identical pull is a no-op.

function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32)
}

describe('applySyncSnapshot — properties', () => {
  const pick = <T,>(r: () => number, xs: T[]): T => xs[Math.floor(r() * xs.length)]!

  function randomState(seed: number): SyncApplyInput {
    const r = lcg(seed)
    const owners = ['creator', 'importer', ''] as const
    const tickets: Ticket[] = []
    const docs: Doc[] = []
    for (let i = 0; i < 6; i++) {
      if (r() < 0.7) {
        const owner = pick(r, [...owners])
        tickets.push(makeTicket({
          id: `tick_${i}`,
          key: pick(r, [`AB-${i + 1}`, `TICK-${i + 1}`]),
          owner,
          origin: owner || 'creator',
          status: pick(r, ['todo', 'in_progress', 'done', 'merged']),
          description: pick(r, ['', 'see /attachments/a.png', '![m](/api/media/alpha/x.png)']),
          comments: r() < 0.5
            ? [makeComment({ id: `cmt_${i}_${Math.floor(r() * 3)}`, owner: pick(r, [...owners]), origin: 'creator' })]
            : [],
        }))
      }
      if (r() < 0.4) {
        const owner = pick(r, [...owners])
        docs.push(makeDoc({
          id: `doc_${i}`,
          key: `DOC-${i + 1}`,
          documentKey: pick(r, ['alpha', 'beta', 'alpha-2']),
          owner,
          origin: owner || 'creator',
        }))
      }
    }
    const snapTickets: Ticket[] = []
    for (let i = 0; i < 6; i++) {
      if (r() < 0.6) {
        snapTickets.push(makeTicket({
          id: r() < 0.5 ? `tick_${i}` : `tick_new_${i}`,
          key: pick(r, [`AB-${i + 2}`, `TICK-${i + 2}`, `AB-${i + 1}`]),
          owner: pick(r, ['importer', 'creator']),
          origin: 'importer',
          title: pick(r, ['A ticket', 'Retitled']),
          description: pick(r, ['', 'see /attachments/a.png']),
          comments: r() < 0.5
            ? [makeComment({ id: `cmt_s_${i}`, owner: pick(r, ['importer', 'creator']), origin: 'importer' })]
            : [],
        }))
      }
    }
    const snapDocs = [] as SyncSnapshot['docs']
    for (let i = 0; i < 4; i++) {
      if (r() < 0.4) {
        snapDocs.push({
          record: makeDoc({
            id: r() < 0.5 ? `doc_${i}` : `doc_new_${i}`,
            key: `DOC-${i + 1}`,
            documentKey: pick(r, ['alpha', 'beta', 'gamma']),
            owner: 'importer',
            origin: 'importer',
          }),
          document: r() < 0.7 ? makeBody(pick(r, ['alpha', 'beta', 'gamma']), pick(r, ['x', 'y'])) : null,
          documentNotes: null,
        })
      }
    }
    return applyInput({
      tickets,
      docs,
      takenTicketKeys: new Set(tickets.map((t) => t.key)),
      takenDocKeys: new Set(docs.map((d) => d.key)),
      existingDocumentKeys: new Set(docs.map((d) => d.documentKey)),
      localAttachments: new Map([['a.png', pick(r, ['AA==', 'BB=='])]]),
      snapshot: makeSnapshot({
        tickets: snapTickets,
        docs: snapDocs,
        peerComments: tickets
          .filter(() => r() < 0.3)
          .map((t) => ({ ticketId: t.id, comments: [makeComment({ id: `cmt_pc_${t.id}`, owner: 'importer', origin: 'importer' })] })),
        attachments: r() < 0.5 ? [{ name: 'a.png', base64: pick(r, ['AA==', 'BB==']) }] : [],
      }),
    })
  }

  const stripPeerComments = (t: Ticket): Ticket => ({
    ...t,
    comments: t.comments.filter((c) => c.owner !== 'importer'),
  })

  it('locally-owned entities survive any snapshot untouched; peer results belong to the peer; pulls converge', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const input = randomState(seed)
      const res = applySyncSnapshot(input)

      for (const before of input.tickets) {
        if (before.owner === 'importer') continue
        const after = res.tickets.find((t) => t.id === before.id)!
        // The record and its locally-owned comments are untouched; only the
        // peer-owned comment subset may move.
        expect(stripPeerComments(after)).toEqual(stripPeerComments(before))
      }
      for (const before of input.docs) {
        if (before.owner === 'importer') continue
        expect(res.docs.find((d) => d.id === before.id)).toEqual(before)
      }
      for (const t of res.tickets) {
        if (!input.tickets.some((b) => b.id === t.id && b.owner !== 'importer')) {
          expect(t.owner).toBe('importer')
        }
      }
      const keys = res.tickets.map((t) => t.key)
      expect(new Set(keys).size).toBe(keys.length)

      const second = applySyncSnapshot(afterApply(input, res))
      expect(second.summary, `seed ${seed}`).toEqual(EMPTY_SUMMARY)
      expect(second.documentWrites).toEqual([])
      expect(second.attachmentWrites).toEqual([])
      expect(JSON.stringify({ t: second.tickets, d: second.docs }))
        .toBe(JSON.stringify({ t: res.tickets, d: res.docs }))
    }
  })
})

// ── Ownership transfer (TICK-295, spec DOC-30 "ownership transfer") ─────────
// Two-phase over pull-only snapshots. During limbo the record is identical on
// both machines — owner already names the transferee, transfer: 'pending' —
// frozen and immune to absence-deletion everywhere. Accept turns the
// transferee's copy into a plain owned ticket; the transferor's next pull sees
// the peer exporting it and finalizes by wholesale replace. Declines travel as
// snapshot transferDeclines entries naming the offer's transferAt stamp.

describe('ownership transfer — export', () => {
  const T1 = '2026-08-24T11:00:00.000Z'

  it('exports a pending ticket it no longer owns, transfer state intact, without duplicating into peerComments', () => {
    // The transferor: owner already flipped to the peer, frozen, still exported.
    const { snapshot } = buildSyncExport(exportInput({
      tickets: [makeTicket({
        id: 'tick_t', key: 'AB-1', origin: 'creator', owner: 'importer', transfer: 'pending', transferAt: T1,
        comments: [
          makeComment({ id: 'cmt_mine', owner: 'creator' }),
          makeComment({ id: 'cmt_theirs', origin: 'importer', owner: 'importer' }),
        ],
      })],
    }))
    expect(snapshot.tickets).toHaveLength(1)
    expect(snapshot.tickets[0]).toMatchObject({
      id: 'tick_t', key: 'AB-1', origin: 'creator', owner: 'importer', transfer: 'pending', transferAt: T1,
    })
    // Own comments ride inline; the ticket is not ALSO in peerComments.
    expect(snapshot.tickets[0]!.comments.map((c) => c.id)).toEqual(['cmt_mine'])
    expect(snapshot.peerComments).toEqual([])
  })

  it('exports the transferee\'s own pending copy still marked pending, never as settled ownership', () => {
    // The transferee before accepting: owner is this side, but transfer must
    // travel — an export claiming transfer '' would finalize the peer early.
    const { snapshot } = buildSyncExport(exportInput({
      tickets: [makeTicket({ id: 'tick_t', key: 'AB-2', origin: 'importer', owner: 'creator', transfer: 'pending', transferAt: T1 })],
    }))
    expect(snapshot.tickets).toHaveLength(1)
    expect(snapshot.tickets[0]).toMatchObject({ owner: 'creator', transfer: 'pending', transferAt: T1 })
  })

  it('does not export a declined ticket as a record — the decline travels as a transferDeclines entry', () => {
    // The decliner: ownership already bounced back to the peer.
    const { snapshot } = buildSyncExport(exportInput({
      tickets: [makeTicket({ id: 'tick_t', key: 'AB-2', origin: 'importer', owner: 'importer', transfer: 'declined', transferAt: T1 })],
    }))
    expect(snapshot.tickets).toEqual([])
    expect(snapshot.transferDeclines).toEqual([{ ticketId: 'tick_t', transferAt: T1 }])
  })

  it('ordinary exports carry no transfer state and no declines', () => {
    const { snapshot } = buildSyncExport(exportInput({ tickets: [makeTicket()] }))
    expect(snapshot.tickets[0]).toMatchObject({ transfer: '', transferAt: '' })
    expect(snapshot.transferDeclines).toEqual([])
  })
})

describe('ownership transfer — apply', () => {
  const T1 = '2026-08-24T11:00:00.000Z'
  const T2 = '2026-08-24T12:00:00.000Z'

  // The peer (importer) offering their ticket to this side (creator).
  const offer = (over: Partial<Ticket> = {}) =>
    theirTicket({ owner: 'creator', transfer: 'pending', transferAt: T1, ...over })

  it('an incoming offer lands as a pending copy of the previously peer-owned ticket', () => {
    const res = applySyncSnapshot(applyInput({
      tickets: [makeTicket({ id: 'tick_p1', key: 'AB-2', origin: 'importer', owner: 'importer' })],
      snapshot: makeSnapshot({ tickets: [offer()] }),
    }))
    expect(res.tickets).toHaveLength(1)
    expect(res.tickets[0]).toMatchObject({
      id: 'tick_p1', key: 'AB-2', origin: 'importer', owner: 'creator', transfer: 'pending', transferAt: T1,
    })
    expect(res.summary.tickets.changed).toEqual(['AB-2'])
    expect(res.dropped).toEqual([])
  })

  it('an offer of a never-pulled ticket lands as a new pending copy', () => {
    const res = applySyncSnapshot(applyInput({ snapshot: makeSnapshot({ tickets: [offer()] }) }))
    expect(res.tickets).toHaveLength(1)
    expect(res.tickets[0]).toMatchObject({ owner: 'creator', transfer: 'pending', transferAt: T1 })
    expect(res.summary.tickets.added).toEqual(['AB-2'])
  })

  it('re-applying the same offer is idempotent — one copy, empty summary', () => {
    const first = applySyncSnapshot(applyInput({ snapshot: makeSnapshot({ tickets: [offer()] }) }))
    const second = applySyncSnapshot(applyInput({
      tickets: first.tickets,
      snapshot: makeSnapshot({ tickets: [offer()] }),
    }))
    expect(second.tickets).toHaveLength(1)
    expect(second.summary.tickets).toEqual({ added: [], changed: [], deleted: [] })
    expect(second.dropped).toEqual([])
  })

  it('an offer whose id is a settled locally-owned ticket is ignored, not merged and not duplicated', () => {
    // The accepted-but-not-yet-finalized window: the peer still exports the
    // offer, this side already owns the ticket outright. Also the hostile case.
    const mine = makeTicket({ id: 'tick_p1', key: 'AB-2', origin: 'importer', owner: 'creator' })
    const res = applySyncSnapshot(applyInput({
      tickets: [mine],
      snapshot: makeSnapshot({ tickets: [offer({ title: 'evil rewrite' })] }),
    }))
    expect(res.tickets).toHaveLength(1)
    expect(res.tickets[0]).toMatchObject({ id: 'tick_p1', owner: 'creator', transfer: '', title: 'A ticket' })
    expect(res.summary.tickets).toEqual({ added: [], changed: [], deleted: [] })
  })

  it('a pending ticket this side gave away survives a snapshot that does not carry it, key still reserved', () => {
    // Transferor limbo: the transferee hasn't pulled the offer yet, so their
    // export lacks the ticket — absence must not delete it, and its parity key
    // must not be handed to anything else.
    const pending = makeTicket({ id: 'tick_t', key: 'AB-1', origin: 'creator', owner: 'importer', transfer: 'pending', transferAt: T1 })
    const res = applySyncSnapshot(applyInput({
      tickets: [pending],
      snapshot: makeSnapshot({ tickets: [theirTicket({ id: 'tick_sneak', key: 'AB-1' })] }),
    }))
    expect(res.tickets.map((t) => t.id)).toEqual(['tick_t'])
    expect(res.tickets[0]).toMatchObject({ transfer: 'pending', owner: 'importer' })
    expect(res.summary.tickets.deleted).toEqual([])
    expect(res.dropped).toEqual(['AB-1'])
  })

  it('a pending offer held on this side survives a snapshot that does not carry it', () => {
    // Transferee limbo, defensively: the transferor always exports a pending
    // ticket, but a snapshot without it must not delete the offer.
    const pendingMine = makeTicket({ id: 'tick_p1', key: 'AB-2', origin: 'importer', owner: 'creator', transfer: 'pending', transferAt: T1 })
    const res = applySyncSnapshot(applyInput({ tickets: [pendingMine], snapshot: makeSnapshot() }))
    expect(res.tickets.map((t) => t.id)).toEqual(['tick_p1'])
    expect(res.tickets[0]).toMatchObject({ transfer: 'pending' })
    expect(res.summary.tickets.deleted).toEqual([])
  })

  it('both copies pending: the peer\'s limbo export applies without churn', () => {
    const pending = makeTicket({
      id: 'tick_t', key: 'AB-2', projectId: 'proj_local', origin: 'importer', owner: 'creator', transfer: 'pending', transferAt: T1,
    })
    const res = applySyncSnapshot(applyInput({
      tickets: [pending],
      snapshot: makeSnapshot({ tickets: [offer({ id: 'tick_t' })] }),
    }))
    expect(res.tickets).toHaveLength(1)
    expect(res.summary.tickets).toEqual({ added: [], changed: [], deleted: [] })
  })

  it('finalize: the peer exporting the ticket as plainly theirs replaces this side\'s pending copy', () => {
    // This side initiated (owner flipped to importer, frozen); the peer
    // accepted and now exports it as a normal owned ticket.
    const pending = makeTicket({ id: 'tick_t', key: 'AB-1', origin: 'creator', owner: 'importer', transfer: 'pending', transferAt: T1 })
    const res = applySyncSnapshot(applyInput({
      tickets: [pending],
      snapshot: makeSnapshot({ tickets: [theirTicket({ id: 'tick_t', key: 'AB-1', origin: 'creator', title: 'now theirs' })] }),
    }))
    expect(res.tickets).toHaveLength(1)
    expect(res.tickets[0]).toMatchObject({
      id: 'tick_t', key: 'AB-1', origin: 'creator', owner: 'importer', transfer: '', transferAt: '', title: 'now theirs',
    })
    // Finalized = out of this side's export set.
    const reExport = buildSyncExport(exportInput({ tickets: res.tickets }))
    expect(reExport.snapshot.tickets).toEqual([])
  })

  it('a matching decline reverts the pending ticket to this side, unfrozen', () => {
    const pending = makeTicket({ id: 'tick_t', key: 'AB-1', origin: 'creator', owner: 'importer', transfer: 'pending', transferAt: T1 })
    const res = applySyncSnapshot(applyInput({
      tickets: [pending],
      snapshot: makeSnapshot({ transferDeclines: [{ ticketId: 'tick_t', transferAt: T1 }] }),
    }))
    expect(res.tickets[0]).toMatchObject({ id: 'tick_t', origin: 'creator', owner: 'creator', transfer: '', transferAt: '' })
    expect(res.summary.tickets.changed).toEqual(['AB-1'])
  })

  it('a decline merges the decliner\'s comments from the same snapshot', () => {
    // The decliner's comments ride peerComments (the ticket is peer-owned on
    // their side again) — the revert must not leave the first post-decline
    // pull without them.
    const pending = makeTicket({ id: 'tick_t', key: 'AB-1', origin: 'creator', owner: 'importer', transfer: 'pending', transferAt: T1 })
    const res = applySyncSnapshot(applyInput({
      tickets: [pending],
      snapshot: makeSnapshot({
        transferDeclines: [{ ticketId: 'tick_t', transferAt: T1 }],
        peerComments: [{
          ticketId: 'tick_t',
          comments: [makeComment({ id: 'cmt_why', body: 'not mine to take', origin: 'importer', owner: 'importer' })],
        }],
      }),
    }))
    expect(res.tickets[0]).toMatchObject({ owner: 'creator', transfer: '' })
    expect(res.tickets[0]!.comments.map((c) => c.id)).toEqual(['cmt_why'])
    expect(res.summary.comments.added).toBe(1)
  })

  it('a stale decline does not touch a re-initiated offer', () => {
    const reOffered = makeTicket({ id: 'tick_t', key: 'AB-1', origin: 'creator', owner: 'importer', transfer: 'pending', transferAt: T2 })
    const res = applySyncSnapshot(applyInput({
      tickets: [reOffered],
      snapshot: makeSnapshot({ transferDeclines: [{ ticketId: 'tick_t', transferAt: T1 }] }),
    }))
    expect(res.tickets[0]).toMatchObject({ transfer: 'pending', transferAt: T2, owner: 'importer' })
    expect(res.summary.tickets).toEqual({ added: [], changed: [], deleted: [] })
  })

  it('a declined copy outlasts the stale re-offer it already declined', () => {
    // The decliner keeps saying no until the transferor reverts: the incoming
    // offer names the same transferAt, so it neither resurrects the offer nor
    // deletes the local copy.
    const declined = makeTicket({ id: 'tick_p1', key: 'AB-2', origin: 'importer', owner: 'importer', transfer: 'declined', transferAt: T1 })
    const res = applySyncSnapshot(applyInput({
      tickets: [declined],
      snapshot: makeSnapshot({ tickets: [offer()] }),
    }))
    expect(res.tickets).toHaveLength(1)
    expect(res.tickets[0]).toMatchObject({ transfer: 'declined', transferAt: T1, owner: 'importer' })
    expect(res.summary.tickets).toEqual({ added: [], changed: [], deleted: [] })
  })

  it('a fresh offer supersedes an old decline', () => {
    const declined = makeTicket({ id: 'tick_p1', key: 'AB-2', origin: 'importer', owner: 'importer', transfer: 'declined', transferAt: T1 })
    const res = applySyncSnapshot(applyInput({
      tickets: [declined],
      snapshot: makeSnapshot({ tickets: [offer({ transferAt: T2 })] }),
    }))
    expect(res.tickets[0]).toMatchObject({ owner: 'creator', transfer: 'pending', transferAt: T2 })
  })

  it('the peer re-exporting a bounced ticket as plainly theirs clears the decline marker', () => {
    const declined = makeTicket({ id: 'tick_p1', key: 'AB-2', origin: 'importer', owner: 'importer', transfer: 'declined', transferAt: T1 })
    const res = applySyncSnapshot(applyInput({
      tickets: [declined],
      snapshot: makeSnapshot({ tickets: [theirTicket()] }),
    }))
    expect(res.tickets[0]).toMatchObject({ owner: 'importer', transfer: '', transferAt: '' })
  })
})
