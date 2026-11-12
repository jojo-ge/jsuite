// The Diff tab's file filters and sort orders (app/utils/diffFiles.ts): what
// kind of file a path is, narrowing a diff to the kinds picked, and ordering
// it by path or by line churn.
import { describe, expect, it } from 'vitest'
import { activeKinds, arrangeFiles, fileKind, isDiffSort, kindCounts } from '../app/utils/diffFiles'

const f = (path: string, additions = 1, deletions = 0, binary = false) => ({ path, additions, deletions, binary })

describe('fileKind', () => {
  it.each([
    // source — including what nothing else claims
    ['apps/jticket/app/utils/diffFiles.ts', 'source'],
    ['apps/jticket/app/components/ProjectDiff.vue', 'source'],
    ['apps/jticket/server/api/projects/[id]/diff/index.get.ts', 'source'],
    ['apps/jticket/app/pages/docs/[id].vue', 'source'],
    ['www/index.html', 'source'],
    ['jsuite', 'source'],
    ['src/latest.ts', 'source'],
    ['src/Contest.java', 'source'],
    ['cmd/main.go', 'source'],
    // tests
    ['apps/jticket/tests/suiteWiring.test.ts', 'test'],
    ['apps/jticket/tests/e2e-bundle-media.sh', 'test'],
    ['src/components/Button.spec.tsx', 'test'],
    ['src/__tests__/helpers.ts', 'test'],
    ['pkg/store/store_test.go', 'test'],
    ['app/test_models.py', 'test'],
    ['spec/models/user_spec.rb', 'test'],
    ['src/main/java/FooTest.java', 'test'],
    ['app/Services/LoginClientTest.php', 'test'],
    ['tests/fixtures/payload.json', 'test'],
    ['tests/README.md', 'test'],
    ['e2e/login.cy.ts', 'test'],
    // docs
    ['README.md', 'docs'],
    ['apps/jticket/.claude/skills/jdiff-tour/SKILL.md', 'docs'],
    ['LICENSE', 'docs'],
    ['notes/plan.txt', 'docs'],
    // config
    ['package.json', 'config'],
    ['apps/jticket/nuxt.config.ts', 'config'],
    ['vitest.e2e.config.ts', 'config'],
    ['docker-compose.yml', 'config'],
    ['Caddyfile', 'config'],
    ['.gitignore', 'config'],
    ['.github/workflows/ci.yml', 'config'],
    ['requirements.txt', 'config'],
    // generated
    ['pnpm-lock.yaml', 'generated'],
    ['Cargo.lock', 'generated'],
    ['src/__snapshots__/Button.test.tsx.snap', 'generated'],
    ['public/app.min.js', 'generated'],
    ['api/v1/service.pb.go', 'generated'],
    ['vendor/lib/thing.go', 'generated'],
    // assets
    ['public/logo.png', 'asset'],
    ['www/fonts/inter.woff2', 'asset'],
  ])('%s → %s', (path, kind) => {
    expect(fileKind(path)).toBe(kind)
  })

  it('calls a binary nothing else claims an asset', () => {
    expect(fileKind('data/model.weights', true)).toBe('asset')
    expect(fileKind('data/model.weights')).toBe('source')
  })
})

const DIFF = [
  f('README.md', 3, 1),
  f('pnpm-lock.yaml', 400, 380),
  f('src/a.ts', 10, 2),
  f('src/b.ts', 50, 40),
  f('src/c.ts', 12, 0),
  f('tests/a.test.ts', 30, 0),
]

describe('kindCounts', () => {
  it('lists only the kinds the diff holds, in chip order, with files and churn', () => {
    expect(kindCounts(DIFF).map((k) => [k.kind, k.files, k.churn])).toEqual([
      ['source', 3, 114],
      ['test', 1, 30],
      ['docs', 1, 4],
      ['generated', 1, 780],
    ])
  })
})

describe('arrangeFiles', () => {
  const paths = (out: { file: { path: string } }[]) => out.map((o) => o.file.path)

  it('keeps the diff as built when nothing is picked', () => {
    const out = arrangeFiles(DIFF)
    expect(paths(out)).toEqual(DIFF.map((d) => d.path))
    expect(out.map((o) => o.index)).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('narrows to the picked kinds and keeps each file’s original index', () => {
    const out = arrangeFiles(DIFF, { kinds: ['source'] })
    expect(paths(out)).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts'])
    expect(out.map((o) => o.index)).toEqual([2, 3, 4])
    expect(paths(arrangeFiles(DIFF, { kinds: ['test', 'docs'] }))).toEqual(['README.md', 'tests/a.test.ts'])
  })

  it('ignores a picked kind the diff has none of, rather than showing nothing', () => {
    expect(activeKinds(['asset'], DIFF)).toEqual([])
    expect(arrangeFiles(DIFF, { kinds: ['asset'] })).toHaveLength(DIFF.length)
    expect(paths(arrangeFiles(DIFF, { kinds: ['asset', 'test'] }))).toEqual(['tests/a.test.ts'])
  })

  it('puts the most churned first, ties in path order', () => {
    expect(paths(arrangeFiles(DIFF, { sort: 'churn' }))).toEqual([
      'pnpm-lock.yaml', 'src/b.ts', 'tests/a.test.ts', 'src/a.ts', 'src/c.ts', 'README.md',
    ])
  })

  it('sorts by additions or deletions alone, and within a filter', () => {
    expect(paths(arrangeFiles(DIFF, { sort: 'additions', kinds: ['source'] }))).toEqual(['src/b.ts', 'src/c.ts', 'src/a.ts'])
    expect(paths(arrangeFiles(DIFF, { sort: 'deletions', kinds: ['source'] }))).toEqual(['src/b.ts', 'src/a.ts', 'src/c.ts'])
  })

  it('does not reorder the list it was given', () => {
    const before = DIFF.map((d) => d.path)
    arrangeFiles(DIFF, { sort: 'churn' })
    expect(DIFF.map((d) => d.path)).toEqual(before)
  })
})

describe('isDiffSort', () => {
  it('accepts only the known orders (what localStorage hands back)', () => {
    expect(isDiffSort('churn')).toBe(true)
    expect(isDiffSort('size')).toBe(false)
    expect(isDiffSort(null)).toBe(false)
  })
})
