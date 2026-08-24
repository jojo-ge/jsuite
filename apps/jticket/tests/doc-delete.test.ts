import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect, beforeEach } from 'vitest'
import { deleteDoc } from '@jsuite/documents/store'

// JSUITE_DATA_DIR points at a throwaway dir (vitest.config.ts), so this reads
// and writes real doc files without touching the suite's .data/.
const DIR = join(process.env.JSUITE_DATA_DIR!, 'jexplain')

describe('deleteDoc', () => {
  beforeEach(() => {
    rmSync(DIR, { recursive: true, force: true })
    mkdirSync(DIR, { recursive: true })
  })

  it('removes the doc, its notes sidecar, and its media dir (note attachments included)', async () => {
    writeFileSync(join(DIR, 'gone.json'), JSON.stringify({ format: 'j-explain', key: 'gone', blocks: [] }))
    writeFileSync(join(DIR, 'gone.notes.json'), JSON.stringify({ general: '', notes: [] }))
    mkdirSync(join(DIR, 'media', 'gone', 'notes'), { recursive: true })
    writeFileSync(join(DIR, 'media', 'gone', 'hero.png'), 'png-bytes')
    writeFileSync(join(DIR, 'media', 'gone', 'notes', 'shot.png'), 'png-bytes')

    await deleteDoc('gone')

    expect(existsSync(join(DIR, 'gone.json'))).toBe(false)
    expect(existsSync(join(DIR, 'gone.notes.json'))).toBe(false)
    expect(existsSync(join(DIR, 'media', 'gone'))).toBe(false)
  })

  it('leaves other docs’ media alone and tolerates a doc with no media dir', async () => {
    writeFileSync(join(DIR, 'plain.json'), JSON.stringify({ format: 'j-explain', key: 'plain', blocks: [] }))
    mkdirSync(join(DIR, 'media', 'other'), { recursive: true })
    writeFileSync(join(DIR, 'media', 'other', 'keep.png'), 'png-bytes')

    await deleteDoc('plain')

    expect(existsSync(join(DIR, 'plain.json'))).toBe(false)
    expect(existsSync(join(DIR, 'media', 'other', 'keep.png'))).toBe(true)
  })

  it('never removes the media root for a key that sanitizes to empty', async () => {
    mkdirSync(join(DIR, 'media', 'other'), { recursive: true })
    writeFileSync(join(DIR, 'media', 'other', 'keep.png'), 'png-bytes')

    await deleteDoc('...')

    expect(existsSync(join(DIR, 'media', 'other', 'keep.png'))).toBe(true)
  })
})
