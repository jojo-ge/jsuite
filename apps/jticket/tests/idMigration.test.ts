import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { currentId, findByRef, isLegacyId, isUuidV7, legacyIdMap, uuidv7, uuidv7Time } from '../server/utils/ids'
import { legacyIdTime, migrateIdsInDir, planIdMigration, rewriteIdsInText } from '../server/utils/idMigration'
import { newId } from '../server/utils/store'

// Ids as the old newId minted them: 8 random base36 chars + Date.now() in base36.
const legacy = (prefix: string, ms: number, rnd = 'abcd1234') => `${prefix}_${rnd}${ms.toString(36)}`
const T0 = Date.UTC(2026, 9, 1, 12)
const iso = (ms: number) => new Date(ms).toISOString()

describe('uuidv7', () => {
  it('mints RFC 9562 v7 ids carrying the given time', () => {
    const id = uuidv7(T0)
    expect(isUuidV7(id)).toBe(true)
    expect(uuidv7Time(id)).toBe(T0)
    expect(uuidv7(T0)).not.toBe(id)
  })

  it('sorts by time, so ids keep creation order', () => {
    const ids = [T0 + 2, T0, T0 + 1000, T0 + 1].map((t) => uuidv7(t))
    expect([...ids].sort().map(uuidv7Time)).toEqual([T0, T0 + 1, T0 + 2, T0 + 1000])
  })

  it('is what newId mints, whatever the prefix', () => {
    expect(isUuidV7(newId('tick'))).toBe(true)
    expect(isUuidV7(newId('graph'))).toBe(true)
  })

  it('never looks like a legacy id, and keys never do either', () => {
    expect(isLegacyId(uuidv7())).toBe(false)
    expect(isLegacyId('TICK-9')).toBe(false)
    expect(isLegacyId(legacy('tick', T0))).toBe(true)
  })
})

describe('planIdMigration', () => {
  const proj = legacy('proj', T0)
  const tick = legacy('tick', T0 + 5000)
  const cmt = legacy('cmt', T0 + 9000)
  const gone = legacy('proj', T0 - 50_000, 'zz99yy88') // a deleted project, still referenced
  const store = {
    projects: [{ id: proj, key: 'PROJ-1', createdAt: iso(T0 + 7) }, { id: 'proj_vibesync', key: 'PROJ-2', createdAt: iso(T0 + 1) }],
    tickets: [{ id: tick, key: 'TICK-1', projectId: proj, blockedBy: [], createdAt: iso(T0 + 5000), comments: [{ id: cmt, createdAt: iso(T0 + 9000) }] }],
    shares: [{ id: legacy('share', T0), projectId: gone, projectUuid: '5c500020-4f20-4ed1-92c2-7af2212ac0ef' }],
  }

  it('maps every entity id, hand-made ones included, timed by createdAt', () => {
    const { map, added } = planIdMigration([{ path: 'jticket/jticket.json', text: JSON.stringify(store) }])
    expect(added).toHaveLength(6)
    for (const id of added) expect(isUuidV7(map[id])).toBe(true)
    expect(uuidv7Time(map[proj]!)).toBe(T0 + 7)
    expect(uuidv7Time(map.proj_vibesync!)).toBe(T0 + 1)
    // A dangling reference has no entity to time it: the old id's own time tail does.
    expect(uuidv7Time(map[gone]!)).toBe(T0 - 50_000)
    expect(legacyIdTime(gone)).toBe(T0 - 50_000)
  })

  it('outside the store, trusts only minted-looking ids — never prose, UUIDs or keys', () => {
    const text = JSON.stringify({ id: 'a7d3c2', note: `see pr_comments and doc_type, ${proj}`, sessionId: uuidv7(), key: 'TICK-4', el: 'abc_d3f' })
    const { added } = planIdMigration([{ path: 'jchart/x.json', text }])
    expect(added).toEqual([proj])
  })

  it('keeps an existing mapping and adds nothing for it', () => {
    const existing = { [proj]: uuidv7(T0) }
    const { map, added } = planIdMigration([{ path: 'a.json', text: JSON.stringify({ projectId: proj }) }], existing)
    expect(added).toEqual([])
    expect(map[proj]).toBe(existing[proj])
  })
})

describe('rewriteIdsInText', () => {
  const proj = legacy('proj', T0)
  const map = { [proj]: uuidv7(T0) }

  it('replaces values, object keys and ids inside longer strings, keeping the 2-space format', () => {
    const text = JSON.stringify({ projectId: proj, runners: { [proj]: 1 }, description: `open /api/projects/${proj}/diff\n${proj}.` }, null, 2) + '\n'
    const { text: out, replaced } = rewriteIdsInText('a.json', text, map)
    expect(replaced).toBe(4)
    expect(out).not.toContain(proj)
    expect(out!.endsWith('}\n')).toBe(true)
    expect(out!.split('\n')[1]).toMatch(/^ {2}"projectId"/)
    const parsed = JSON.parse(out!)
    expect(parsed.description).toBe(`open /api/projects/${map[proj]}/diff\n${map[proj]}.`)
  })

  it('leaves an id that merely shares a prefix alone, and unchanged files untouched', () => {
    expect(rewriteIdsInText('a.json', JSON.stringify({ x: `${proj}x`, y: 'proj_other123' }), map).text).toBeNull()
  })

  it('does a .jsonl line by line, keeping compact lines', () => {
    const text = `${JSON.stringify({ projectId: proj, kind: 'run-started' })}\n${JSON.stringify({ projectId: 'p' })}\n`
    const out = rewriteIdsInText('run-journal.jsonl', text, map).text!
    expect(out.split('\n')).toHaveLength(3)
    expect(JSON.parse(out.split('\n')[0]!).projectId).toBe(map[proj])
  })
})

describe('migrateIdsInDir', () => {
  function fixture(): string {
    const root = mkdtempSync(join(tmpdir(), 'idmig-'))
    const dir = join(root, 'data')
    const proj = legacy('proj', T0)
    const tick = legacy('tick', T0 + 1)
    const write = (rel: string, v: unknown, compact = false) => {
      mkdirSync(dirname(join(dir, rel)), { recursive: true })
      writeFileSync(join(dir, rel), (compact ? JSON.stringify(v) : JSON.stringify(v, null, 2)) + '\n')
    }
    write('jticket/jticket.json', {
      projects: [{ id: proj, key: 'PROJ-1', createdAt: iso(T0) }],
      tickets: [{ id: tick, key: 'TICK-1', projectId: proj, blockedBy: [tick], createdAt: iso(T0 + 1), comments: [] }],
    })
    write('jticket/sessions.json', { sessions: [{ id: '015c433a-81c3-4c58-bdcb-0ee65936a57d', projectId: proj, tickets: ['TICK-1'] }] })
    write('jticket/harness/sessions/015c433a.json', { record: { projectId: proj } }, true)
    write('jreview/r.json', { project: 'PROJ-1', tickets: { ticketKeys: ['TICK-1'] } })
    write('jreview/worktrees/repo/package.json', { name: proj }) // someone's checkout: never walked
    return dir
  }

  it('dry-runs without touching anything', () => {
    const dir = fixture()
    const before = readFileSync(join(dir, 'jticket/jticket.json'), 'utf8')
    const r = migrateIdsInDir(dir, { dryRun: true })
    expect(r.added).toEqual({ proj: 1, tick: 1 })
    expect(r.files.map((f) => f.path).sort()).toEqual(['jticket/harness/sessions/015c433a.json', 'jticket/jticket.json', 'jticket/sessions.json'])
    expect(readFileSync(join(dir, 'jticket/jticket.json'), 'utf8')).toBe(before)
    expect(readdirSync(dirname(dir))).toEqual(['data'])
  })

  it('backs up, saves the map, rewrites every reference — and a second run is a no-op', () => {
    const dir = fixture()
    const original = readFileSync(join(dir, 'jticket/jticket.json'), 'utf8')
    const r = migrateIdsInDir(dir, { at: new Date(T0 + 99) })
    expect(r.noop).toBe(false)
    expect(readFileSync(join(r.backupDir, 'jticket/jticket.json'), 'utf8')).toBe(original)

    const map = JSON.parse(readFileSync(r.mapFile, 'utf8')).map as Record<string, string>
    const store = JSON.parse(readFileSync(join(dir, 'jticket/jticket.json'), 'utf8'))
    const [p] = store.projects
    const [t] = store.tickets
    expect(isUuidV7(p.id) && isUuidV7(t.id)).toBe(true)
    expect(t.projectId).toBe(p.id)
    expect(t.blockedBy).toEqual([t.id])
    expect(Object.values(map).sort()).toEqual([p.id, t.id].sort())
    expect(JSON.parse(readFileSync(join(dir, 'jticket/sessions.json'), 'utf8')).sessions[0]).toMatchObject({ id: '015c433a-81c3-4c58-bdcb-0ee65936a57d', projectId: p.id })
    expect(JSON.parse(readFileSync(join(dir, 'jticket/harness/sessions/015c433a.json'), 'utf8')).record.projectId).toBe(p.id)
    expect(readFileSync(join(dir, 'jreview/worktrees/repo/package.json'), 'utf8')).toContain('proj_')

    const mapText = readFileSync(r.mapFile, 'utf8')
    const storeText = readFileSync(join(dir, 'jticket/jticket.json'), 'utf8')
    const again = migrateIdsInDir(dir)
    expect(again).toMatchObject({ noop: true, backupDir: '', files: [], added: {} })
    expect(readFileSync(r.mapFile, 'utf8')).toBe(mapText)
    expect(readFileSync(join(dir, 'jticket/jticket.json'), 'utf8')).toBe(storeText)
    expect(readdirSync(dirname(dir))).toHaveLength(2) // data + the one backup
  })

  it('feeds the legacy lookup: an old id still finds its entity', () => {
    const dir = fixture()
    const r = migrateIdsInDir(dir)
    const map = legacyIdMap(r.mapFile)
    const [oldProj, newProj] = [...map.entries()].find(([k]) => k.startsWith('proj_'))!
    expect(map.get(oldProj)).toBe(newProj)
  })
})

describe('currentId / findByRef', () => {
  it('resolves ids and keys; a legacy id with no migration map stays as it is', () => {
    const list = [{ id: uuidv7(T0), key: 'PROJ-1' }, { id: uuidv7(T0 + 1), key: 'PROJ-2' }]
    expect(findByRef(list, 'PROJ-2')).toBe(list[1])
    expect(findByRef(list, list[0]!.id)).toBe(list[0])
    expect(findByRef(list, undefined)).toBeUndefined()
    expect(currentId('proj_abcd1234mwbljmng')).toBe('proj_abcd1234mwbljmng')
    expect(currentId('PROJ-1')).toBe('PROJ-1')
  })

  it('resolves a legacy id through the saved map', () => {
    // The worker's data root is where ids.ts reads the map (ID_MIGRATION_FILE).
    const dataDir = process.env.JSUITE_DATA_DIR!
    const old = legacy('proj', T0)
    const fresh = uuidv7(T0)
    mkdirSync(join(dataDir, 'jticket'), { recursive: true })
    writeFileSync(join(dataDir, 'jticket/id-migration.json'), JSON.stringify({ version: 1, runs: [], map: { [old]: fresh } }))
    const list = [{ id: fresh, key: 'PROJ-7' }]
    expect(currentId(old)).toBe(fresh)
    expect(findByRef(list, old)).toBe(list[0])
  })
})
