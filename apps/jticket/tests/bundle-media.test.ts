import { describe, it, expect } from 'vitest'
import { docMediaRefs, rewriteDocMediaUrls } from '../server/utils/bundle'

// Doc media URLs come in two shapes (see packages/documents/server/utils/media.ts):
//   block image:      /api/media/<docKey>/<file>
//   note attachment:  /api/media/<docKey>/notes/<file>

describe('docMediaRefs', () => {
  it('extracts block-image and note-attachment refs from mixed text', () => {
    const text = JSON.stringify({
      blocks: [{ type: 'image', src: '/api/media/spec-doc/arch.png' }],
      notes: [{ attachments: [{ src: '/api/media/spec-doc/notes/shot-1.png' }] }],
    })
    expect(docMediaRefs(text)).toEqual([
      { docKey: 'spec-doc', name: 'arch.png', notes: false },
      { docKey: 'spec-doc', name: 'shot-1.png', notes: true },
    ])
  })

  it('dedupes repeated references to the same file', () => {
    const text = '/api/media/d/a.png … /api/media/d/a.png … /api/media/d/notes/a.png'
    expect(docMediaRefs(text)).toEqual([
      { docKey: 'd', name: 'a.png', notes: false },
      { docKey: 'd', name: 'a.png', notes: true },
    ])
  })

  it('ignores jticket /attachments/ urls and unrelated paths', () => {
    expect(docMediaRefs('see /attachments/diagram.png and /api/documents/spec-doc')).toEqual([])
  })

  it('does not mistake a top-level file named notes.png for a note attachment', () => {
    expect(docMediaRefs('/api/media/d/notes.png')).toEqual([{ docKey: 'd', name: 'notes.png', notes: false }])
  })
})

describe('rewriteDocMediaUrls', () => {
  const renames = new Map([['spec-doc', 'spec-doc-2']])

  it('rewrites block and note urls of a renamed doc key', () => {
    const text = 'a /api/media/spec-doc/arch.png b /api/media/spec-doc/notes/shot.png c'
    expect(rewriteDocMediaUrls(text, renames)).toBe(
      'a /api/media/spec-doc-2/arch.png b /api/media/spec-doc-2/notes/shot.png c',
    )
  })

  it('leaves other doc keys and non-media urls alone', () => {
    const text = '/api/media/other-doc/x.png /attachments/spec-doc.png /api/documents/spec-doc'
    expect(rewriteDocMediaUrls(text, renames)).toBe(text)
  })

  it('does not rewrite a key that only prefixes another key', () => {
    expect(rewriteDocMediaUrls('/api/media/spec-doc-extra/x.png', renames)).toBe('/api/media/spec-doc-extra/x.png')
  })

  it('is identity for an empty rename map', () => {
    const text = '/api/media/spec-doc/arch.png'
    expect(rewriteDocMediaUrls(text, new Map())).toBe(text)
  })
})
