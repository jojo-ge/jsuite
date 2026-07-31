// Heuristic buckets for the "type" file-list breakdown. The goal is to let
// the reviewer collapse the noise (lockfiles, migrations, docs, images) and
// focus on source + tests.
export type FileCategory =
  | 'source'
  | 'tests'
  | 'config'
  | 'docs'
  | 'data'
  | 'assets'
  | 'generated'

export const CATEGORY_ORDER: FileCategory[] = [
  'source',
  'tests',
  'config',
  'docs',
  'data',
  'assets',
  'generated',
]

export const CATEGORY_LABELS: Record<FileCategory, string> = {
  source: 'source',
  tests: 'tests',
  config: 'config',
  docs: 'docs',
  data: 'seed / migration data',
  assets: 'assets',
  generated: 'generated / lockfiles',
}

const LOCKFILES =
  /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb?|deno\.lock|cargo\.lock|go\.sum|composer\.lock|gemfile\.lock|poetry\.lock|uv\.lock|flake\.lock)$/
const GENERATED =
  /\.(min\.(?:js|css)|map|snap)$|(^|\/)(__snapshots__|__generated__|generated|dist|build|out|coverage)\//
const TEST_DIRS = /(^|\/)(__tests__|__mocks__|tests?|spec|e2e|cypress|playwright)\//
const TEST_FILES =
  /\.(test|spec)\.[cm]?[jt]sx?$|(\.|_)(test|spec)\.(go|py|rb|rs|ex|exs|php|java|kt|swift)$/
const DATA_DIRS = /(^|\/)(migrations?|migrate|seeds?|seed[-_]data|fixtures?|testdata)\//
const DATA_EXT = /\.(sql|csv|tsv|parquet|ndjson|jsonl)$/
const DOC_EXT = /\.(mdx?|rst|adoc|txt)$/
const DOC_DIRS = /(^|\/)docs?\//
const DOC_FILES = /^(license|licence|changelog|contributing|code_of_conduct|readme|notice|authors|codeowners)(\.|$)/
const ASSET_EXT =
  /\.(png|jpe?g|gif|svg|ico|webp|avif|bmp|tiff?|woff2?|ttf|otf|eot|mp[34]|webm|wav|ogg|pdf)$/
const CONFIG_EXT = /\.(ya?ml|toml|ini|conf|env|properties|plist)$/
const CONFIG_FILES =
  /^(dockerfile|makefile|justfile|procfile|package\.json|tsconfig(\..*)?\.json|jsconfig\.json|deno\.jsonc?|pyproject\.toml|cargo\.toml|go\.mod|.*\.(config|rc)\.[cm]?[jt]s)$/

export function categorize(path: string): FileCategory {
  const p = path.toLowerCase()
  const base = p.split('/').pop() ?? p

  if (LOCKFILES.test(p) || GENERATED.test(p)) return 'generated'
  if (TEST_DIRS.test(p) || TEST_FILES.test(p) || /^test_.*\.py$/.test(base)) return 'tests'
  if (DATA_DIRS.test(p) || DATA_EXT.test(p)) return 'data'
  if (DOC_EXT.test(p) || DOC_DIRS.test(p) || DOC_FILES.test(base)) return 'docs'
  if (ASSET_EXT.test(p)) return 'assets'
  if (base.startsWith('.') || CONFIG_EXT.test(p) || CONFIG_FILES.test(base)) return 'config'
  return 'source'
}
