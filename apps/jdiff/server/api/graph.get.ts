// File-relationship graph for a PR: which changed files reference each other.
// Edges come from import/include statements ('import' kind) plus whole-word
// basename mentions ('mention' kind — catches Nuxt auto-imports, templates,
// configs). Connected files form clusters; unlinked files are clustered by
// top-level directory so the view stays organized.

export interface GraphNode {
  path: string
  cluster: string
}
export interface GraphEdge {
  source: string
  target: string
  kind: 'import' | 'mention'
}
export interface GraphCluster {
  id: string
  label: string
  linked: boolean
}

const MAX_FILE_BYTES = 512 * 1024

// Extensions tried when an import specifier omits one (js resolution rules,
// plus the other languages we extract specifiers from).
const RESOLVE_EXTS = [
  '', '.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.vue',
  '.svelte', '.css', '.scss', '.sass', '.less', '.py', '.rb', '.go', '.rs',
  '.php', '.java', '.kt', '.swift', '.json',
]

const SPEC_PATTERNS: RegExp[] = [
  // js/ts: import x from '...', export ... from '...', import('...'), require('...')
  /\bimport\s+(?:[\s\S]{0,200}?\bfrom\s+)?['"]([^'"\n]+)['"]/g,
  /\bexport\s+[\s\S]{0,200}?\bfrom\s+['"]([^'"\n]+)['"]/g,
  /\brequire(?:_relative)?\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g,
  // css/scss
  /@(?:import|use|forward)\s+['"]([^'"\n]+)['"]/g,
  // c/c++/objc
  /^[ \t]*#(?:include|import)\s+["<]([^">\n]+)[">]/gm,
  // go / generic quoted import lines
  /^[ \t]*import\s+(?:\w+\s+)?"([^"\n]+)"/gm,
]
// python: dotted module paths become slash paths
const PY_PATTERNS: RegExp[] = [
  /^[ \t]*from\s+([\w.]+)\s+import\b/gm,
  /^[ \t]*import\s+([\w.]+)/gm,
]

function extractSpecs(content: string, path: string): string[] {
  const specs = new Set<string>()
  for (const re of SPEC_PATTERNS) {
    re.lastIndex = 0
    for (const m of content.matchAll(re)) specs.add(m[1]!)
  }
  if (path.endsWith('.py')) {
    for (const re of PY_PATTERNS) {
      re.lastIndex = 0
      for (const m of content.matchAll(re)) {
        const mod = m[1]!
        specs.add(mod.replace(/\./g, '/'))
        // relative python imports: leading dots
        if (mod.startsWith('.')) {
          const dots = mod.match(/^\.+/)![0].length
          specs.add('../'.repeat(dots - 1) + './' + mod.slice(dots).replace(/\./g, '/'))
        }
      }
    }
  }
  return [...specs]
}

function normalize(parts: string[]): string | null {
  const out: string[] = []
  for (const part of parts) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (!out.length) return null
      out.pop()
    } else out.push(part)
  }
  return out.join('/')
}

// Map a specifier from `fromPath` to a changed file, or null. Relative specs
// resolve exactly; bare/aliased specs match by path suffix.
function resolveSpec(fromPath: string, rawSpec: string, changed: Set<string>): string | null {
  let spec = rawSpec.split(/[?#]/)[0]!.trim()
  if (!spec || spec.startsWith('http') || spec.startsWith('//')) return null
  spec = spec.replace(/^[~@]\//, '').replace(/^~/, '')

  const tryPaths = (base: string): string | null => {
    for (const ext of RESOLVE_EXTS) {
      if (changed.has(base + ext)) return base + ext
    }
    for (const ext of RESOLVE_EXTS.slice(1)) {
      if (changed.has(base + '/index' + ext)) return base + '/index' + ext
    }
    return null
  }

  if (rawSpec.startsWith('.')) {
    const dir = fromPath.split('/').slice(0, -1)
    const base = normalize([...dir, ...spec.split('/')])
    return base ? tryPaths(base) : null
  }

  // bare / root-aliased: exact from repo root, then unique suffix match
  const direct = tryPaths(spec)
  if (direct) return direct
  const suffixes = new Set<string>()
  for (const p of changed) {
    for (const ext of RESOLVE_EXTS) {
      if (p === spec + ext || p.endsWith('/' + spec + ext)) suffixes.add(p)
    }
  }
  return suffixes.size === 1 ? [...suffixes][0]! : null
}

function commonPrefix(paths: string[]): string {
  const split = paths.map((p) => p.split('/').slice(0, -1))
  let prefix = split[0] ?? []
  for (const parts of split.slice(1)) {
    let i = 0
    while (i < prefix.length && prefix[i] === parts[i]) i++
    prefix = prefix.slice(0, i)
  }
  return prefix.join('/')
}

export default defineEventHandler(async (event): Promise<{
  nodes: GraphNode[]
  edges: GraphEdge[]
  clusters: GraphCluster[]
}> => {
  const path = resolveRepoPath(event)
  const target = resolveTarget(event)
  const prepared = await prepareTarget(target, path)

  const headRef = prepared.headRef
  const baseRef = target.kind === 'pr' ? `origin/${prepared.base}` : prepared.base

  const nameStatus = await run(
    'git',
    ['diff', '--name-status', '--no-color', '-M', `${baseRef}...${headRef}`],
    path,
  )

  // path -> ref to read content from (deleted files only exist on the base)
  const fileRefs = new Map<string, string>()
  for (const line of nameStatus.split('\n')) {
    if (!line.trim()) continue
    const [status, a, b] = line.split('\t')
    if (!status || !a) continue
    if (status.startsWith('R') || status.startsWith('C')) fileRefs.set(b ?? a, headRef)
    else if (status === 'D') fileRefs.set(a, baseRef)
    else fileRefs.set(a, headRef)
  }

  const changed = new Set(fileRefs.keys())

  const contents = new Map<string, string>()
  await Promise.all(
    [...fileRefs].map(async ([p, ref]) => {
      try {
        const text = await run('git', ['show', `${ref}:${p}`], path)
        if (text.length <= MAX_FILE_BYTES && !text.includes('\0')) contents.set(p, text)
      } catch { /* binary / unreadable: no outgoing edges */ }
    }),
  )

  // import edges
  const edgeKeys = new Map<string, GraphEdge>()
  const addEdge = (a: string, b: string, kind: GraphEdge['kind']) => {
    if (a === b) return
    const key = a < b ? `${a}\n${b}` : `${b}\n${a}`
    const existing = edgeKeys.get(key)
    if (existing) {
      if (kind === 'import') existing.kind = 'import'
      return
    }
    edgeKeys.set(key, { source: a, target: b, kind })
  }

  for (const [p, content] of contents) {
    for (const spec of extractSpecs(content, p)) {
      const target = resolveSpec(p, spec, changed)
      if (target) addEdge(p, target, 'import')
    }
  }

  // mention edges: file A's content names file B's basename as a whole word
  // (catches auto-imported components, templates, docs referencing code).
  const basenames = [...changed]
    .map((p) => {
      const base = (p.split('/').pop() ?? '').replace(/\..*$/, '')
      return {
        path: p,
        base,
        re: new RegExp(`(?<![\\w$])${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w$])`),
      }
    })
    .filter((e) => e.base.length >= 4 && !/^(index|main|init|utils|types|test|spec|readme)$/i.test(e.base))

  const mentionPairs: [string, string][] = []
  for (const [p, content] of contents) {
    for (const { path: other, re } of basenames) {
      if (other !== p && re.test(content)) mentionPairs.push([p, other])
    }
  }
  // Mentions get noisy on big PRs (a design-system PR mentions every
  // component everywhere); cap mention degree per node so the graph stays
  // readable while imports remain exact.
  const MAX_MENTION_DEGREE = 4
  const mentionDegree = new Map<string, number>()
  for (const [a, b] of mentionPairs) {
    const key = a < b ? `${a}\n${b}` : `${b}\n${a}`
    if (edgeKeys.has(key)) continue
    const da = mentionDegree.get(a) ?? 0
    const db = mentionDegree.get(b) ?? 0
    if (da >= MAX_MENTION_DEGREE || db >= MAX_MENTION_DEGREE) continue
    mentionDegree.set(a, da + 1)
    mentionDegree.set(b, db + 1)
    addEdge(a, b, 'mention')
  }

  const edges = [...edgeKeys.values()]

  // clusters: connected components; singletons grouped by top-level dir
  const parent = new Map<string, string>()
  const find = (x: string): string => {
    let r = x
    while (parent.get(r) !== r) r = parent.get(r)!
    parent.set(x, r)
    return r
  }
  for (const p of changed) parent.set(p, p)
  for (const e of edges) parent.set(find(e.source), find(e.target))

  const components = new Map<string, string[]>()
  for (const p of changed) {
    const root = find(p)
    ;(components.get(root) ?? components.set(root, []).get(root)!).push(p)
  }

  const clusters: GraphCluster[] = []
  const clusterOf = new Map<string, string>()
  const dirClusters = new Map<string, string[]>()
  let linkedIdx = 0

  for (const members of components.values()) {
    if (members.length === 1) {
      const top = members[0]!.includes('/') ? members[0]!.split('/')[0]! : '(root)'
      ;(dirClusters.get(top) ?? dirClusters.set(top, []).get(top)!).push(members[0]!)
      continue
    }
    const id = `c${linkedIdx++}`
    // Label with the shared path prefix; when members span top-level dirs,
    // fall back to the most common first segment.
    let label = commonPrefix(members)
    if (!label) {
      const tops = new Map<string, number>()
      for (const m of members) {
        const top = m.includes('/') ? m.split('/')[0]! : '(root)'
        tops.set(top, (tops.get(top) ?? 0) + 1)
      }
      const best = [...tops].sort((a, b) => b[1] - a[1])[0]!
      label = tops.size > 1 ? `${best[0]} +${tops.size - 1}` : best[0]
    }
    clusters.push({ id, label, linked: true })
    for (const m of members) clusterOf.set(m, id)
  }

  for (const [dir, members] of [...dirClusters].sort((a, b) => b[1].length - a[1].length)) {
    const id = `d:${dir}`
    clusters.push({ id, label: dir, linked: false })
    for (const m of members) clusterOf.set(m, id)
  }

  const nodes: GraphNode[] = [...changed].map((p) => ({ path: p, cluster: clusterOf.get(p)! }))

  return { nodes, edges, clusters }
})
