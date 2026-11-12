// The Diff tab's file filters and sort orders: which kind of file a path is
// (source, tests, docs, config, generated, assets), narrowing a diff to the
// kinds picked, and ordering it — git's path order, or by line churn so the
// most affected files come first. Read off the path alone; ProjectDiff.vue
// applies it to the file list and the files shown.
import type { DiffFile } from './diffRows'

export type FileKind = 'source' | 'test' | 'docs' | 'config' | 'generated' | 'asset'

/** The kinds, in the order their chips show. */
export const FILE_KINDS: { kind: FileKind; label: string; hint: string }[] = [
  { kind: 'source', label: 'Source', hint: 'Code that ships' },
  { kind: 'test', label: 'Tests', hint: 'Tests, specs, fixtures and mocks' },
  { kind: 'docs', label: 'Docs', hint: 'Markdown and other prose' },
  { kind: 'config', label: 'Config', hint: 'Settings, manifests, CI and build config' },
  { kind: 'generated', label: 'Generated', hint: 'Lockfiles, snapshots and generated or vendored code' },
  { kind: 'asset', label: 'Assets', hint: 'Images, fonts, media and other binaries' },
]

const LOCKFILES = new Set([
  'pnpm-lock.yaml', 'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'bun.lock', 'bun.lockb',
  'cargo.lock', 'go.sum', 'poetry.lock', 'uv.lock', 'pipfile.lock', 'gemfile.lock', 'composer.lock',
  'flake.lock', 'packages.lock.json', 'podfile.lock', 'mix.lock',
])
const GENERATED_DIRS = new Set(['__snapshots__', '__generated__', 'generated', 'dist', 'vendor', 'node_modules'])
const GENERATED_NAME = /\.snap$|\.lock$|\.min\.(js|css)$|\.map$|\.(generated|gen)\.[^.]+$|\.pb\.go$|_pb2(_grpc)?\.pyi?$|\.g\.dart$/

const TEST_DIRS = new Set([
  'test', 'tests', '__tests__', 'spec', 'e2e', 'testdata', 'testing', 'test-utils',
  '__mocks__', '__fixtures__', 'fixtures', 'cypress', 'playwright',
])
// foo.test.ts, foo.spec.tsx, foo.e2e.ts, foo.cy.ts · foo_test.go, foo_spec.rb · test_foo.py · FooTest.java, FooTest.php, FooTests.cs, FooSpec.scala
const TEST_NAME = /\.(test|spec|e2e|cy)\.[^.]+$|_(test|spec)\.[^.]+$|^test_[^/]*\.py$|^conftest\.py$|[a-z0-9](Tests?|Spec|IT)\.(java|kt|kts|cs|scala|groovy|swift|php)$/

const DOC_EXT = /\.(md|mdx|markdown|rst|adoc|txt)$/
const DOC_NAME = /^(readme|changelog|license|licence|notice|authors|contributing|code_of_conduct)(\.[^.]+)?$/

const CONFIG_EXT = /\.(json|jsonc|json5|ya?ml|toml|ini|cfg|conf|properties|env|tf|tfvars|plist|xcconfig)$/
const CONFIG_NAME = /^(dockerfile|containerfile|makefile|caddyfile|procfile|justfile|rakefile|gemfile|brewfile|codeowners)(\.[^/]*)?$|\.config\.[cm]?[jt]s$|^(vite|vitest|nuxt|next|jest|webpack|rollup|eslint|prettier|tailwind|postcss|babel|playwright|tsup|drizzle)\.[^/]*\.[cm]?[jt]s$/
// Plain-text files that are settings, not prose.
const CONFIG_TXT = /^(requirements[^/]*|constraints[^/]*|cmakelists|robots)\.txt$/
const CONFIG_DIRS = new Set(['.github', '.husky', '.vscode', '.idea', '.circleci', '.devcontainer'])

const ASSET_EXT = /\.(png|jpe?g|gif|webp|avif|ico|icns|bmp|tiff?|svg|woff2?|ttf|otf|eot|mp3|wav|ogg|flac|mp4|mov|webm|pdf|zip|gz|tgz|tar|7z|wasm|bin|pen|excalidraw)$/

/**
 * What kind of file a path is. Checked most specific first: a lockfile or
 * snapshot is generated wherever it sits, anything under a tests directory is
 * a test (its fixtures and README included), and what nothing claims is
 * source — so an unknown extension never drops out of "source only".
 */
export function fileKind(path: string, binary = false): FileKind {
  const parts = path.split('/')
  const rawName = parts.pop() ?? ''
  const name = rawName.toLowerCase()
  const dirs = parts.map((d) => d.toLowerCase())

  if (LOCKFILES.has(name) || GENERATED_NAME.test(name) || dirs.some((d) => GENERATED_DIRS.has(d))) return 'generated'
  // The JVM-style suffix (FooTest.java) is case-sensitive, so it reads the name as written.
  if (TEST_NAME.test(rawName) || TEST_NAME.test(name) || dirs.some((d) => TEST_DIRS.has(d))) return 'test'
  if (ASSET_EXT.test(name)) return 'asset'
  if (CONFIG_TXT.test(name)) return 'config'
  // By extension only: a `docs/` directory is as often a route or a module as it is prose.
  if (DOC_EXT.test(name) || DOC_NAME.test(name)) return 'docs'
  // Dotfiles (.gitignore, .npmrc, .env.local) are settings; so is anything in a tooling directory.
  if (name.startsWith('.') || CONFIG_EXT.test(name) || CONFIG_NAME.test(name) || dirs.some((d) => CONFIG_DIRS.has(d))) return 'config'
  return binary ? 'asset' : 'source'
}

export const kindOf = (file: Pick<DiffFile, 'path' | 'binary'>): FileKind => fileKind(file.path, file.binary)

/** Lines added plus lines removed — how much of the change sits in this file. */
export const churn = (file: Pick<DiffFile, 'additions' | 'deletions'>): number => file.additions + file.deletions

export interface KindCount { kind: FileKind; label: string; hint: string; files: number; churn: number }

/** The kinds a diff holds, in chip order, with how many files and lines each carries. */
export function kindCounts(files: Pick<DiffFile, 'path' | 'binary' | 'additions' | 'deletions'>[]): KindCount[] {
  const by = new Map<FileKind, { files: number; churn: number }>()
  for (const f of files) {
    const at = by.get(kindOf(f)) ?? { files: 0, churn: 0 }
    at.files++
    at.churn += churn(f)
    by.set(kindOf(f), at)
  }
  return FILE_KINDS.filter((k) => by.has(k.kind)).map((k) => ({ ...k, ...by.get(k.kind)! }))
}

/**
 * The picked kinds that this diff actually holds. A pick left over from
 * another target (tests only, on a diff with no tests) filters nothing rather
 * than emptying the tab — so an empty result here means "show every file".
 */
export function activeKinds(picked: FileKind[], files: Pick<DiffFile, 'path' | 'binary'>[]): FileKind[] {
  if (!picked.length) return []
  const present = new Set(files.map(kindOf))
  return picked.filter((k) => present.has(k))
}

export type DiffSort = 'path' | 'churn' | 'additions' | 'deletions'

export const DIFF_SORTS: { value: DiffSort; label: string }[] = [
  { value: 'path', label: 'By path' },
  { value: 'churn', label: 'Most churn' },
  { value: 'additions', label: 'Most added' },
  { value: 'deletions', label: 'Most removed' },
]

export const isDiffSort = (v: unknown): v is DiffSort => DIFF_SORTS.some((s) => s.value === v)

const SORT_SIZE: Record<Exclude<DiffSort, 'path'>, (f: Pick<DiffFile, 'additions' | 'deletions'>) => number> = {
  churn,
  additions: (f) => f.additions,
  deletions: (f) => f.deletions,
}

export interface ListedFile<F> { file: F; /** Its place in the diff as built — what its anchor is named by. */ index: number }

/**
 * The files to show: those of the picked kinds (none picked = all), in the
 * chosen order. 'path' keeps the diff's own order (git's, by path); the others
 * put the biggest first, ties staying in path order.
 */
export function arrangeFiles<F extends Pick<DiffFile, 'path' | 'binary' | 'additions' | 'deletions'>>(
  files: F[],
  opts: { kinds?: FileKind[]; sort?: DiffSort } = {},
): ListedFile<F>[] {
  const kinds = activeKinds(opts.kinds ?? [], files)
  const out = files
    .map((file, index) => ({ file, index }))
    .filter(({ file }) => !kinds.length || kinds.includes(kindOf(file)))
  const sort = opts.sort ?? 'path'
  if (sort === 'path') return out
  const size = SORT_SIZE[sort]
  return out.sort((a, b) => size(b.file) - size(a.file) || a.index - b.index)
}
