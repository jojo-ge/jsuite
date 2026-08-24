import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect, beforeEach } from 'vitest'
import { readDocNotes } from '@jsuite/documents/store'

// JSUITE_DATA_DIR points at a throwaway dir (vitest.config.ts), so this reads
// and writes real sidecar files without touching the suite's .data/.
const DIR = join(process.env.JSUITE_DATA_DIR!, 'jexplain')

describe('readDocNotes', () => {
  beforeEach(() => {
    // Clean only this suite's own keys — the pool dir is shared with other
    // test files running in parallel, so nuking it wholesale races them.
    for (const key of ['e2e-doc', 'nope']) {
      rmSync(join(DIR, `${key}.json`), { force: true })
      rmSync(join(DIR, `${key}.notes.json`), { force: true })
      rmSync(join(DIR, 'media', key), { recursive: true, force: true })
    }
    mkdirSync(DIR, { recursive: true })
  })

  it('preserves generalAttachments so they can travel in a bundle', async () => {
    const sidecar = {
      general: 'overall impressions',
      notes: [
        {
          id: 'n1',
          blockId: 'img1',
          label: 'Image #1',
          text: 'looks off',
          attachments: [{ id: 'a1', src: '/api/media/e2e-doc/notes/shot.png', kind: 'shot' }],
        },
      ],
      generalAttachments: [{ id: 'a2', src: '/api/media/e2e-doc/notes/overview.png', kind: 'shot' }],
    }
    writeFileSync(join(DIR, 'e2e-doc.notes.json'), JSON.stringify(sidecar))

    const notes = await readDocNotes('e2e-doc')
    expect(notes.notes[0]?.attachments?.[0]?.src).toBe('/api/media/e2e-doc/notes/shot.png')
    expect(notes.generalAttachments).toEqual(sidecar.generalAttachments)
  })

  it('still defaults cleanly when the sidecar is missing', async () => {
    expect(await readDocNotes('nope')).toEqual({ general: '', notes: [], generalAttachments: [] })
  })
})
