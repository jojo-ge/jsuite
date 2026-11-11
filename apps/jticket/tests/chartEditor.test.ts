import { describe, expect, it } from 'vitest'
import { chartNotesMarkdown, newChartNote } from '../../../packages/charting/app/utils/chartNotes'
import type { SceneElement } from '../../../packages/charting/app/utils/scene'
import { chartAwaitingLayout, chartEditorPath, chartSummary, deleteChartPrompt } from '../app/utils/chartLibrary'

const box = (id: string, extra: Partial<SceneElement> = {}): SceneElement => ({ id, type: 'rectangle', ...extra })
const caption = (id: string, containerId: string, text: string): SceneElement => ({ id, type: 'text', containerId, text })

describe('chartEditorPath', () => {
  it('is the editor route, key encoded', () => {
    expect(chartEditorPath('sync-arch')).toBe('/charts/sync-arch')
    expect(chartEditorPath('a b')).toBe('/charts/a%20b')
  })
})

describe('chart list helpers', () => {
  it('summarises shapes and notes, singular and plural', () => {
    expect(chartSummary({ elementCount: 1, noteCount: 0 })).toBe('1 shape')
    expect(chartSummary({ elementCount: 3, noteCount: 1 })).toBe('3 shapes · 1 note')
    expect(chartSummary({ elementCount: 0, noteCount: 2 })).toBe('0 shapes · 2 notes')
  })
  it('flags Mermaid charts not laid out yet', () => {
    expect(chartAwaitingLayout({ hasSource: true, imported: false })).toBe(true)
    expect(chartAwaitingLayout({ hasSource: true, imported: true })).toBe(false)
    expect(chartAwaitingLayout({ hasSource: false, imported: false })).toBe(false)
  })
  it('names the chart in the delete confirm', () => {
    expect(deleteChartPrompt('Sync')).toContain('"Sync"')
  })
})

describe('newChartNote', () => {
  it('pins an empty note to the shape under its bound caption', () => {
    const els = [box('a', { boundElements: [{ id: 't', type: 'text' }] }), caption('t', 'a', 'API gateway')]
    const n = newChartNote(els[0]!, els)
    expect(n).toMatchObject({ elementId: 'a', label: 'API gateway', text: '' })
    expect(n.id).toMatch(/^n[a-z0-9]+$/)
  })
})

describe('chartNotesMarkdown', () => {
  const els = [
    box('a', { boundElements: [{ id: 't', type: 'text' }] }),
    caption('t', 'a', 'Renamed gateway'),
    box('b'),
  ]

  it('lists files, general notes, written shape notes under live labels, and the canvas', () => {
    const md = chartNotesMarkdown({
      key: 'sync',
      title: 'Sync',
      general: '  tighten this  ',
      notes: [
        { id: 'n1', elementId: 'a', label: 'Old name', text: 'split it' },
        { id: 'n2', elementId: 'b', label: 'b', text: '   ' },
        { id: 'n3', elementId: 'gone', label: 'Queue', text: 'drop' },
      ],
      elements: els,
      source: { type: 'mermaid', text: 'flowchart TD\n A-->B\n' },
    })
    expect(md).toContain('## Chart notes: Sync')
    expect(md).toContain('.data/jchart/sync.json')
    expect(md).toContain('.data/jchart/sync.notes.json')
    expect(md).toContain('### General notes\ntighten this\n')
    expect(md).toContain('- **Renamed gateway**: split it')
    expect(md).toContain('- **Queue** _(shape deleted)_: drop')
    expect(md).not.toContain('**b**')
    // the bound caption isn't a shape of its own
    expect(md).toContain('2 shapes on the canvas, laid out from the Mermaid below')
    expect(md).toContain('```mermaid\nflowchart TD\n A-->B\n```')
  })

  it('says hand-drawn and skips empty sections when there is no source or notes', () => {
    const md = chartNotesMarkdown({ key: 'k', title: 'T', general: '', notes: [], elements: [box('a')], source: { type: 'blank', text: '' } })
    expect(md).not.toContain('### General notes')
    expect(md).not.toContain('### Shape annotations')
    expect(md).toContain('1 shape on the canvas, drawn by hand.')
  })
})
