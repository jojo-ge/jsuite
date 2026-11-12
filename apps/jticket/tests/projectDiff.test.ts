// The Diff tab: building side-by-side rows from a raw diff, highlighting them,
// the target links/queries, and loading a real repo's diff by target.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildDiff } from '../server/utils/diffBuild'
import { escapeHtml, highlightLines, HIGHLIGHT_MAX_LINES, langForPath } from '../server/utils/diffHighlight'
import {
  diffTabUrl,
  diffTargetParams,
  localPrRefs,
  parseDiffTarget,
  sameDiffTarget,
  ticketDiffTarget,
} from '../app/utils/diffTarget'

// Nitro's auto-imported createError, for the error paths of the server utils.
;(globalThis as any).createError ??= (o: { statusCode: number; statusMessage: string }) =>
  Object.assign(new Error(o.statusMessage), o)

const strip = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')

const RAW = `diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,4 +1,5 @@
 const a = 1
-const b = 2
-const c = 3
+const b = 20
+const c = 30
+const d = 40
 export { a }
@@ -10,2 +11,2 @@ function tail() {
-  return 1
+  return 2
 }
diff --git a/new.md b/new.md
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/new.md
@@ -0,0 +1,2 @@
+# Title
+body
diff --git a/old.txt b/old.txt
deleted file mode 100644
index 4444444..0000000
--- a/old.txt
+++ /dev/null
@@ -1 +0,0 @@
-gone
diff --git a/from.ts b/to.ts
similarity index 90%
rename from from.ts
rename to to.ts
index 5555555..6666666 100644
--- a/from.ts
+++ b/to.ts
@@ -1 +1 @@
-export const x = 1
+export const x = 2
diff --git a/logo.png b/logo.png
index 7777777..8888888 100644
Binary files a/logo.png and b/logo.png differ
`

describe('buildDiff', () => {
  it('parses every file with its status, counts and paths', async () => {
    const files = await buildDiff(RAW)
    expect(files.map((f) => [f.path, f.status, f.additions, f.deletions, f.oldPath])).toEqual([
      ['src/a.ts', 'modified', 4, 3, null],
      ['new.md', 'added', 2, 0, null],
      ['old.txt', 'deleted', 0, 1, null],
      ['to.ts', 'renamed', 1, 1, 'from.ts'],
      ['logo.png', 'modified', 0, 0, null],
    ])
    expect(files[4]!.binary).toBe(true)
    expect(files[0]!.binary).toBe(false)
  })

  it('tells a pure rename from a binary change — neither has hunks', async () => {
    const raw = `diff --git a/old/name.ts b/new/name.ts
similarity index 100%
rename from old/name.ts
rename to new/name.ts
diff --git a/img.png b/img.png
new file mode 100644
index 0000000..1234567
Binary files /dev/null and b/img.png differ
`
    const files = await buildDiff(raw)
    expect(files.map((f) => [f.path, f.status, f.binary, f.hunks.length])).toEqual([
      ['new/name.ts', 'renamed', false, 0],
      ['img.png', 'added', true, 0],
    ])
  })

  it('pairs a run of deletions with its additions, padding the shorter side', async () => {
    const [a] = await buildDiff(RAW)
    const hunk = a!.hunks[0]!
    expect(hunk.header).toMatch(/^@@ -1,4 \+1,5 @@/)
    const shape = hunk.rows.map((r) => `${r.left.type}:${r.left.num ?? '-'}|${r.right.type}:${r.right.num ?? '-'}`)
    expect(shape).toEqual([
      'ctx:1|ctx:1',
      'del:2|add:2',
      'del:3|add:3',
      'empty:-|add:4',
      'ctx:4|ctx:5',
    ])
    expect(strip(hunk.rows[1]!.left.html)).toBe('const b = 2')
    expect(strip(hunk.rows[1]!.right.html)).toBe('const b = 20')
    expect(hunk.rows[3]!.left.html).toBe('')
    expect(a!.hunks[1]!.rows.map((r) => [r.left.num, r.right.num])).toEqual([[10, 11], [11, 12]])
  })

  it('keeps added and deleted files one-sided', async () => {
    const files = await buildDiff(RAW)
    const added = files[1]!.hunks[0]!.rows
    expect(added.every((r) => r.left.type === 'empty' && r.right.type === 'add')).toBe(true)
    const deleted = files[2]!.hunks[0]!.rows
    expect(deleted.map((r) => [r.left.type, r.right.type])).toEqual([['del', 'empty']])
  })

  it('skips the "no newline at end of file" marker', async () => {
    const raw = `diff --git a/x.txt b/x.txt
index 1..2 100644
--- a/x.txt
+++ b/x.txt
@@ -1 +1 @@
-old
\\ No newline at end of file
+new
\\ No newline at end of file
`
    const [x] = await buildDiff(raw)
    expect(x!.hunks[0]!.rows.map((r) => [r.left.type, strip(r.left.html), r.right.type, strip(r.right.html)]))
      .toEqual([['del', 'old', 'add', 'new']])
  })

  it('returns nothing for an empty diff', async () => {
    expect(await buildDiff('')).toEqual([])
  })
})

describe('highlightLines', () => {
  it('picks a language by extension or basename, none for unknown files', () => {
    expect(langForPath('a/b/c.ts')).toBe('typescript')
    expect(langForPath('App.VUE')).toBe('vue')
    expect(langForPath('Dockerfile')).toBe('docker')
    expect(langForPath('Makefile')).toBe('make')
    expect(langForPath('LICENSE')).toBeUndefined()
    expect(langForPath('notes.weird')).toBeUndefined()
  })

  it('emits one line per input, coloured for both themes, text intact', async () => {
    const lines = ['const s = `a', 'b` // <tag>', '']
    const html = await highlightLines(lines, 'x.ts')
    expect(html).toHaveLength(3)
    expect(html.map(strip)).toEqual(lines)
    expect(html[0]).toMatch(/<span style="color:#[0-9A-Fa-f]{6};--shiki-dark:#[0-9A-Fa-f]{6}/)
    // Text is escaped — a "<tag>" in source never becomes markup.
    expect(html[1]).not.toContain('<tag>')
    expect(html[1]).toContain('&lt;tag&gt;')
  })

  it('falls back to escaped plain text for unknown languages and oversized input', async () => {
    expect(await highlightLines(['<b>&</b>'], 'README')).toEqual([escapeHtml('<b>&</b>')])
    const big = Array.from({ length: HIGHLIGHT_MAX_LINES + 1 }, (_, i) => `const x${i} = 1`)
    const out = await highlightLines(big, 'big.ts')
    expect(out[0]).toBe('const x0 = 1')
  })
})

describe('diff targets', () => {
  it('builds tab links and parses them back', () => {
    expect(diffTabUrl('PROJ-1')).toBe('/projects/PROJ-1?tab=diff')
    expect(diffTabUrl('PROJ-1', { pr: 'PR-3' })).toBe('/projects/PROJ-1?tab=diff&pr=PR-3')
    expect(diffTabUrl('PROJ-1', { gh: 12 })).toBe('/projects/PROJ-1?tab=diff&gh=12')
    const url = diffTabUrl('PROJ-1', { head: 'tick/TICK-7-x', base: 'proj/one' })
    expect(url).toBe('/projects/PROJ-1?tab=diff&head=tick%2FTICK-7-x&base=proj%2Fone')
    const q = Object.fromEntries(new URL(url, 'http://x').searchParams)
    expect(parseDiffTarget(q)).toEqual({ head: 'tick/TICK-7-x', base: 'proj/one' })
    expect(parseDiffTarget({ gh: '12' })).toEqual({ gh: 12 })
    // A JSON body (the tour routes) spells it as a number.
    expect(parseDiffTarget({ gh: 12 })).toEqual({ gh: 12 })
    expect(parseDiffTarget({ gh: 'nope' })).toEqual({})
    expect(parseDiffTarget({ pr: ['PR-1', 'PR-2'] })).toEqual({ pr: 'PR-1' })
    expect(parseDiffTarget({})).toEqual({})
    expect(diffTargetParams({ head: 'a' })).toEqual({ head: 'a' })
    expect(sameDiffTarget({ pr: 'PR-1' }, { pr: 'PR-1' })).toBe(true)
    expect(sameDiffTarget({}, { pr: 'PR-1' })).toBe(false)
  })

  it("diffs a local PR's branches while open, its squash commit once merged", () => {
    expect(localPrRefs({ status: 'open', headBranch: 'tick/a', baseBranch: 'proj/x' })).toEqual({ head: 'tick/a', base: 'proj/x' })
    expect(localPrRefs({ status: 'merged', headBranch: 'tick/a', baseBranch: 'proj/x', mergeCommit: 'abc1234', mergeParent: 'def5678' }))
      .toEqual({ head: 'abc1234', base: 'def5678' })
    expect(localPrRefs({ status: 'merged', headBranch: 'tick/a', baseBranch: 'proj/x', mergeCommit: 'abc1234', mergeParent: '' }))
      .toEqual({ head: 'abc1234', base: 'abc1234^' })
    expect(localPrRefs({ status: 'merged', headBranch: 'tick/a', baseBranch: 'proj/x', mergeCommit: '' })).toBeNull()
  })

  it("points a ticket at its newest live PR, else its branch vs the integration branch", () => {
    const project = { repo: '~/r', integrationBranch: 'proj/x' }
    const ticket = { id: 't1', branch: 'tick/T-1' }
    const refs = { headBranch: 'tick/T-1', baseBranch: 'proj/x', mergeCommit: 'abc1234', mergeParent: 'def5678' }
    const prs = [
      { key: 'PR-1', ticketId: 't1', status: 'closed', updatedAt: '2026-01-03', ...refs },
      { key: 'PR-4', ticketId: 't1', status: 'merged', updatedAt: '2026-01-02T12', ...refs, mergeCommit: '' },
      { key: 'PR-2', ticketId: 't1', status: 'merged', updatedAt: '2026-01-02', ...refs },
      { key: 'PR-3', ticketId: 't2', status: 'open', updatedAt: '2026-01-04', ...refs },
    ]
    // PR-4 is newer but has nothing to diff, so PR-2 wins.
    expect(ticketDiffTarget(ticket, project, prs)).toEqual({ pr: 'PR-2' })
    expect(ticketDiffTarget(ticket, project, [])).toEqual({ head: 'tick/T-1', base: 'proj/x' })
    expect(ticketDiffTarget({ id: 't1', branch: '' }, project, [])).toBeNull()
    expect(ticketDiffTarget(ticket, { repo: '', integrationBranch: 'proj/x' }, prs)).toBeNull()
  })
})

describe('loadProjectDiff / loadFileLines over a real repo', () => {
  let repo: string
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()
  let mod: typeof import('../server/utils/projectDiff')

  beforeAll(async () => {
    repo = mkdtempSync(join(tmpdir(), 'jticket-diff-'))
    git('init', '-q', '-b', 'main')
    git('config', 'user.email', 'test@example.com')
    git('config', 'user.name', 'test')
    writeFileSync(join(repo, 'a.ts'), Array.from({ length: 30 }, (_, i) => `export const v${i + 1} = ${i + 1}`).join('\n') + '\n')
    git('add', '.')
    git('commit', '-q', '-m', 'base')
    git('checkout', '-q', '-b', 'proj/x')
    writeFileSync(join(repo, 'a.ts'), Array.from({ length: 30 }, (_, i) => `export const v${i + 1} = ${i === 14 ? 'changed' : i + 1}`).join('\n') + '\n')
    git('commit', '-q', '-am', 'change line 15')
    // main moves on after the branch was cut — three-dot keeps it out of the diff.
    git('checkout', '-q', 'main')
    writeFileSync(join(repo, 'other.txt'), 'later on main\n')
    git('add', '.')
    git('commit', '-q', '-m', 'main moves')
    mod = await import('../server/utils/projectDiff')
  })
  afterAll(() => rmSync(repo, { recursive: true, force: true }))

  it("diffs head against the merge-base, so only the head's own change shows", async () => {
    const res = await mod.loadProjectDiff(repo, { kind: 'refs', label: 'proj/x', head: 'proj/x', base: 'main' })
    expect(res.target.headOid).toBe(git('rev-parse', 'proj/x'))
    expect(res.files.map((f) => f.path)).toEqual(['a.ts'])
    const rows = res.files[0]!.hunks[0]!.rows
    const changed = rows.find((r) => r.left.type === 'del')!
    expect([changed.left.num, changed.right.num]).toEqual([15, 15])
    expect(strip(changed.right.html)).toBe('export const v15 = changed')
    // Cached by commit pair: the same object comes back.
    const again = await mod.loadProjectDiff(repo, { kind: 'refs', label: 'proj/x', head: 'proj/x', base: 'main' })
    expect(again.files).toBe(res.files)
  })

  it("diffs a merged PR's commit against its parent fallback (commit^)", async () => {
    const res = await mod.loadProjectDiff(repo, { kind: 'pr', label: 'PR-1', head: git('rev-parse', 'proj/x'), base: `${git('rev-parse', 'proj/x')}^` })
    expect(res.files.map((f) => f.path)).toEqual(['a.ts'])
  })

  it('refuses refs that are not in the clone', async () => {
    await expect(mod.loadProjectDiff(repo, { kind: 'refs', label: 'x', head: 'nope', base: 'main' })).rejects.toThrow(/head nope is not in this clone/)
  })

  it('reads a whole file at the head commit for gap expansion', async () => {
    const lines = await mod.loadFileLines(repo, git('rev-parse', 'proj/x'), 'a.ts')
    expect(lines).toHaveLength(30)
    expect(strip(lines[14]!)).toBe('export const v15 = changed')
    await expect(mod.loadFileLines(repo, 'main', 'a.ts')).rejects.toThrow(/commit oid/)
    await expect(mod.loadFileLines(repo, git('rev-parse', 'proj/x'), 'missing.ts')).rejects.toThrow(/cannot read/)
  })
})

describe('gap expansion', async () => {
  const { diffGaps, gapViews, expandGap, EXPAND_STEP } = await import('../app/utils/diffGaps')
  // Hunks at new lines 5–7 and 40–41 of a 60-line file: 4 hidden above, 32 between, the rest trailing.
  const file = {
    status: 'modified',
    binary: false,
    hunks: [{ header: '@@ -5,2 +5,3 @@' }, { header: '@@ -39,2 +40,2 @@ fn()' }],
  }
  const full = Array.from({ length: 60 }, (_, i) => `L${i + 1}`)

  it('finds the gaps from the hunk headers, left numbers following the old side', () => {
    expect(diffGaps(file)).toEqual([
      { leftEnd: 0, rightEnd: 0, hidden: 4 },
      { leftEnd: 6, rightEnd: 7, hidden: 32 },
      { leftEnd: 40, rightEnd: 41, hidden: null },
    ])
    expect(diffGaps({ ...file, status: 'deleted' })).toEqual([])
    expect(diffGaps({ ...file, binary: true })).toEqual([])
    // An added file has no trailing gap; a bad header disables expansion.
    expect(diffGaps({ ...file, status: 'added', hunks: [{ header: '@@ -0,0 +1,3 @@' }] })).toEqual([{ leftEnd: 0, rightEnd: 0, hidden: 0 }])
    expect(diffGaps({ ...file, hunks: [{ header: 'garbage' }] })).toEqual([])
  })

  it('reveals rows down from above and up from below, with both sides numbered', () => {
    const gaps = diffGaps(file)
    let st = expandGap(32, undefined, 'down')
    expect(st).toEqual({ top: EXPAND_STEP, bottom: 0 })
    st = expandGap(32, st, 'up')
    expect(st).toEqual({ top: 20, bottom: 12 })
    const views = gapViews(gaps, { 1: st }, full)
    const v = views[1]!
    expect(v.remaining).toBe(0)
    expect(v.topRows[0]).toEqual({ leftNum: 7, rightNum: 8, html: 'L8' })
    expect(v.bottomRows.at(-1)).toEqual({ leftNum: 38, rightNum: 39, html: 'L39' })
    expect(expandGap(32, { top: 5, bottom: 3 }, 'all')).toEqual({ top: 29, bottom: 3 })
  })

  it("leaves the trailing gap's size unknown until the file is loaded", () => {
    const gaps = diffGaps(file)
    const before = gapViews(gaps, {}, null)
    expect(before[2]).toMatchObject({ remaining: null, trailing: true, bottomRows: [] })
    expect(before[0]).toMatchObject({ remaining: 4, first: true, trailing: false })
    const after = gapViews(gaps, {}, full)
    expect(after[2]!.remaining).toBe(19)
    // Nothing hidden → no gap row at all.
    expect(gapViews(gaps, {}, full.slice(0, 41))[2]).toBeNull()
  })
})
