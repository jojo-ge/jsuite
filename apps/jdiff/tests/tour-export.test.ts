import { beforeAll, describe, expect, it } from 'vitest'
import type { TourStop } from '../app/utils/tour'

// tourExport reaches for Nitro's auto-imports (the diff cache, the target
// preparer, git, shiki). Stub them as globals — this test is about the page
// the exporter builds from those inputs, not about git.
const calls: { showFile: string[] } = { showFile: [] }
let diffFiles: any[] = []
let fileContent = ''

let buildTourExport: typeof import('../server/utils/tourExport')['buildTourExport']
let exportFilename: typeof import('../server/utils/tourExport')['exportFilename']
let variantLabel: typeof import('../server/utils/tourExport')['variantLabel']

beforeAll(async () => {
  Object.assign(globalThis, {
    diffFilesFor: async () => diffFiles,
    prepareTarget: async () => ({ leftSpec: 'main', rightSpec: 'head' }),
    showFile: async (_t: any, _repo: string, path: string) => {
      calls.showFile.push(path)
      if (!fileContent) throw new Error('no such file')
      return fileContent
    },
    // Real highlighting is shiki's job; the exporter only passes it through.
    highlightLines: async (lines: string[]) => lines.map((l) => l.replace(/</g, '&lt;')),
  })
  const mod = await import('../server/utils/tourExport')
  buildTourExport = mod.buildTourExport
  exportFilename = mod.exportFilename
  variantLabel = mod.variantLabel
})

const cell = (num: number | null, type: string, html: string) => ({ num, type, html })
const stop = (over: Partial<TourStop> = {}): TourStop => ({
  path: 'src/a.ts',
  side: 'RIGHT',
  line: 2,
  endLine: 2,
  title: 'The rename',
  note: 'why it **matters**',
  ...over,
})

const target = { kind: 'pr' as const, storeKey: '7', number: '7', branch: null, base: null, scope: 'committed' as const }

const exportOf = (stops: TourStop[]) => buildTourExport({
  repoPath: '/tmp/repo',
  target,
  variant: 'overview',
  tour: { overview: 'the change', stops },
  createdAt: '2026-01-02T03:04:05.000Z',
  title: 'A change',
  topic: null,
})

describe('tour export', () => {
  beforeAll(() => {
    diffFiles = [{
      path: 'src/a.ts',
      oldPath: null,
      status: 'modified',
      hunks: [{
        header: '@@ -1,2 +1,2 @@',
        rows: [
          { left: cell(1, 'ctx', 'one'), right: cell(1, 'ctx', 'one') },
          { left: cell(2, 'del', 'old'), right: cell(2, 'add', 'new') },
        ],
      }],
    }]
  })

  it('renders one section per stop, with the note beside the code', async () => {
    const html = await exportOf([stop(), stop({ title: 'Second', line: 1, endLine: 1 })])
    expect(html.match(/<section class="stop"/g)).toHaveLength(2)
    expect(html).toContain('The rename')
    // The note is markdown, rendered into the page.
    expect(html).toContain('<strong>matters</strong>')
    // Self-contained: styles inlined, nothing fetched at view time.
    expect(html).toContain('<style>')
    expect(html).not.toContain('<script')
  })

  it('marks the stop’s own lines and no others', async () => {
    const html = await exportOf([stop()])
    // Line 2 on the right is the stop; the addition carries the wash, the
    // deletion it replaced and the context line above do not.
    expect(html).toContain('<div class="src add hit">')
    expect(html).toContain('<div class="src del">')
    expect(html).toContain('<div class="src ctx">')
  })

  it('reads unchanged code off the file when no hunk covers the stop', async () => {
    fileContent = 'a\nb\nc\n'
    calls.showFile = []
    const html = await exportOf([stop({ path: 'src/untouched.ts', line: 2, endLine: 2 })])
    expect(calls.showFile).toEqual(['src/untouched.ts'])
    expect(html).toContain('unchanged code')
    // A whole-file window numbers once, not old-and-new.
    expect(html).toContain('class="code plain"')
  })

  it('keeps a stop whose file cannot be read, without its code', async () => {
    fileContent = ''
    const html = await exportOf([stop({ path: 'src/gone.ts' })])
    expect(html).toContain('code not available')
    expect(html).toContain('The rename')
  })

  it('escapes titles and paths rather than trusting the tour', async () => {
    fileContent = 'a\n'
    const html = await exportOf([stop({ path: 'src/<img>.ts', title: '<script>x</script>', line: 1, endLine: 1 })])
    expect(html).not.toContain('<script>x')
    expect(html).toContain('&lt;script&gt;x')
  })

  it('names the download after the target and variant', () => {
    expect(exportFilename(target, 'detail')).toBe('tour-pr-7-detail.html')
    expect(exportFilename({ ...target, kind: 'branch', number: null, branch: 'feat/Thing' }, 'chain:a-b'))
      .toBe('tour-feat-thing-chain-a-b.html')
    expect(variantLabel('chain:a-b', 'A Chain')).toBe('chain · A Chain')
    expect(variantLabel('chain:a-b')).toBe('chain · a-b')
    expect(variantLabel('issue:leaky', 'Leaky path')).toBe('issue · Leaky path')
    expect(variantLabel('issue:leaky')).toBe('issue · leaky')
  })
})
