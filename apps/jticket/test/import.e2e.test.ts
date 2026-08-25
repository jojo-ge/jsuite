import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { api, ok } from './helpers'
import { startInstance, type Instance } from './harness/instance'

// The import screen's server half, across two real jTicket instances (spec
// DOC-30, TICK-292): A shares a project and hands the link's fragment to B,
// whose import endpoints validate it, create the local shared project with the
// importer side, and record the share for later pulls. No relay involved —
// importing only writes local state; dialing the room is the pull flow's job.

let A: Instance
let B: Instance

beforeAll(async () => {
  ;[A, B] = await Promise.all([startInstance({ label: 'import-a' }), startInstance({ label: 'import-b' })])
})

afterAll(async () => {
  await Promise.all([A?.dispose(), B?.dispose()])
})

/** Share a fresh project on `instance` under `sharedKey` → the link's fragment. */
async function shareOut(instance: Instance, title: string, sharedKey: string): Promise<string> {
  const project = await ok(instance, 'POST', '/api/projects', { title })
  const { share } = await ok(instance, 'POST', `/api/projects/${project.id}/share`, { sharedKey, peerName: 'Bo' })
  return share.link.split('#')[1]!
}

describe('importing a share link across two instances', () => {
  it('validate previews the import; confirm creates the shared project and records the share', async () => {
    const fragment = await shareOut(A, 'Checkout revamp', 'CART')

    const { preview } = await ok(B, 'POST', '/api/shares/validate', { fragment })
    expect(preview).toMatchObject({ sharedKey: 'CART', side: 'importer', existingProjectId: null })

    const { project } = await ok(B, 'POST', '/api/shares/import', { fragment, peerName: 'Ana' })
    expect(project.share).toEqual({ key: 'CART', side: 'importer', peerName: 'Ana' })

    // The share is on record for later pulls — room and peer known.
    const { share } = await ok(B, 'GET', `/api/projects/${project.id}/share`)
    expect(share).toMatchObject({ sharedKey: 'CART', side: 'importer', status: 'active' })

    // AC: the importing side mints even ticket numbers thereafter.
    const t1 = await ok(B, 'POST', '/api/tickets', { title: 'first local ticket', projectId: project.id })
    const t2 = await ok(B, 'POST', '/api/tickets', { title: 'second local ticket', projectId: project.id })
    expect(t1.key).toBe('CART-2')
    expect(t2.key).toBe('CART-4')
  })

  it('re-importing a re-armed link lands on the same project with the fresh room', async () => {
    const projectA = await ok(A, 'POST', '/api/projects', { title: 'Search relaunch' })
    const first = await ok(A, 'POST', `/api/projects/${projectA.id}/share`, { sharedKey: 'SRCH', peerName: 'Bo' })
    const imported = await ok(B, 'POST', '/api/shares/import', {
      fragment: first.share.link.split('#')[1]!,
      peerName: 'Ana',
    })

    const rearmed = await ok(A, 'POST', `/api/projects/${projectA.id}/share`, {})
    const fragment = rearmed.share.link.split('#')[1]!

    const { preview } = await ok(B, 'POST', '/api/shares/validate', { fragment })
    expect(preview.existingProjectId).toBe(imported.project.id)

    const again = await ok(B, 'POST', '/api/shares/import', { fragment })
    expect(again.project.id).toBe(imported.project.id)

    const projects = await ok(B, 'GET', '/api/projects')
    expect(projects.filter((p: { key: string }) => p.key === imported.project.key)).toHaveLength(1)
  })

  it('rejects a shared key already in use locally, so the pair renegotiates', async () => {
    // B is itself sharing a project under PAY; A's PAY link then clashes on B.
    await shareOut(B, 'Payments — local', 'PAY')
    const fragment = await shareOut(A, 'Payments — shared', 'PAY')

    const validated = await api(B, 'POST', '/api/shares/validate', { fragment })
    expect(validated.status).toBe(409)
    expect(validated.body.statusMessage ?? validated.body.message).toMatch(/renegotiate/)

    const confirmed = await api(B, 'POST', '/api/shares/import', { fragment, peerName: 'Ana' })
    expect(confirmed.status).toBe(409)
  })

  it("rejects the creator's own link on the machine that minted it", async () => {
    const fragment = await shareOut(A, 'Docs cleanup', 'DOCX')
    const res = await api(A, 'POST', '/api/shares/import', { fragment, peerName: 'me' })
    expect(res.status).toBe(409)
    expect(res.body.statusMessage ?? res.body.message).toMatch(/own share link/)
  })

  it('rejects garbage fragments and requires a peer name on first import', async () => {
    const garbage = await api(B, 'POST', '/api/shares/validate', { fragment: 'not-a-blob' })
    expect(garbage.status).toBe(400)

    const fragment = await shareOut(A, 'Nameless import', 'NAME')
    const unnamed = await api(B, 'POST', '/api/shares/import', { fragment })
    expect(unnamed.status).toBe(400)
    expect(unnamed.body.statusMessage ?? unnamed.body.message).toMatch(/name/i)
  })
})
