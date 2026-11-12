import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

// The suite's docs describe one app (TICK-951): the root CLAUDE.md and
// README, the `jsuite` skill and the static site in www/. These checks keep
// them honest — every endpoint, page and skill they name exists on the
// branch, and none of them sends a reader to a retired app.

const ROOT = join(__dirname, '..', '..', '..')
const APP = join(ROOT, 'apps', 'jticket')
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8')

function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? filesUnder(path) : [path]
  })
}

const DOCS = ['CLAUDE.md', 'README.md', '.claude/skills/jsuite/SKILL.md', '.claude/skills/jsuite/reference/api.md']
const SITE = filesUnder(join(ROOT, 'www'))
  .filter((f) => f.endsWith('.html'))
  .map((f) => relative(ROOT, f))

/** Route files → segment lists: `[id]` is a param, `index` and the method suffix drop. */
function routes(apiDir: string): string[][] {
  return filesUnder(apiDir)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .map((f) =>
      relative(apiDir, f)
        .replace(/\.ts$/, '')
        .replace(/\.(get|post|put|patch|delete)$/, '')
        .split('/')
        .filter((seg) => seg !== 'index'),
    )
}

const API_ROUTES = [
  ...routes(join(APP, 'server', 'api')),
  ...routes(join(ROOT, 'packages', 'documents', 'server', 'api')),
  ...routes(join(ROOT, 'packages', 'charting', 'server', 'api')),
]

const PAGE_ROUTES = filesUnder(join(APP, 'app', 'pages'))
  .filter((f) => f.endsWith('.vue'))
  .map((f) =>
    relative(join(APP, 'app', 'pages'), f)
      .replace(/\.vue$/, '')
      .split('/')
      .filter((seg) => seg !== 'index'),
  )

const isParam = (seg: string) => seg.startsWith('[')

/** Does a documented path (segments after /api, or after / for a page) name a real route? */
function routeExists(table: string[][], doc: string[], prefix: boolean): boolean {
  return table.some((route) => {
    if (prefix ? route.length < doc.length : route.length !== doc.length) return false
    return doc.every((seg, i) => isParam(route[i]!) || seg === route[i])
  })
}

/** Split a written path into segments; `:id`, `<key>`, `KEY`, `DOC-n` and the like are values. */
function docSegments(path: string): { segs: string[]; prefix: boolean } {
  let p = path.replace(/[?#].*$/, '')
  let prefix = false
  if (/(\/\*\*|…|\/\*)$/.test(p)) {
    prefix = true
    p = p.replace(/(\/\*\*|…|\/\*)$/, '')
  }
  const segs = p.split('/').filter(Boolean)
  return { segs, prefix }
}

/** Every `/api/…` path written in a doc, with its line for the failure message. */
function apiPaths(text: string): string[] {
  return [...text.matchAll(/\/api\/[A-Za-z0-9_:<>\-./*…\[\]]+/g)]
    .map((m) => m[0].replace(/<\/.*$/, '').replace(/[.,;:)]+$/, ''))
    .filter((p) => !p.startsWith('/api/_nuxt_icon'))
}

/** A value segment in a doc path: a placeholder, a key, or a literal the route takes as a param. */
const valueSeg = (seg: string) => /^(:|<|\[)|^[A-Z][A-Z0-9]*(-[A-Za-z0-9]+)?$|^G-KEY$/.test(seg)

function apiPathExists(path: string): boolean {
  const { segs, prefix } = docSegments(path.slice('/api'.length))
  // A value segment matches any param; written literals must match exactly.
  return API_ROUTES.some((route) => {
    if (prefix ? route.length < segs.length : route.length !== segs.length) return false
    return segs.every((seg, i) => (valueSeg(seg) ? isParam(route[i]!) : isParam(route[i]!) || seg === route[i]))
  })
}

describe('the suite docs name only what exists', () => {
  it('tells a real route from a retired one', () => {
    expect(apiPathExists('/api/projects/:id/diff/tour/artifact')).toBe(true)
    expect(apiPathExists('/api/docs/DOC-43')).toBe(true)
    expect(apiPathExists('/api/reviews/**')).toBe(true)
    expect(apiPathExists('/api/repos/worktree?repo=')).toBe(true)
    // Retired with the Branches tab, jDiff and jReview's own server.
    expect(apiPathExists('/api/projects/:id/branch-status')).toBe(false)
    expect(apiPathExists('/api/prs/:id/review')).toBe(false)
    expect(apiPathExists('/api/analyze-dispatch')).toBe(false)
    expect(apiPathExists('/api/branches')).toBe(false)
  })

  it('every /api path in the docs and the site is a route on this branch', () => {
    const missing: string[] = []
    for (const file of [...DOCS, ...SITE]) {
      for (const path of apiPaths(read(file))) {
        if (!apiPathExists(path)) missing.push(`${file}: ${path}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('every jticket.local page the site links to is a page on this branch', () => {
    const missing: string[] = []
    for (const file of SITE) {
      for (const m of read(file).matchAll(/https:\/\/jticket\.local(\/[^"#?\s<]*)?/g)) {
        const { segs } = docSegments(m[1] ?? '/')
        if (!routeExists(PAGE_ROUTES, segs, false)) missing.push(`${file}: ${m[0]}`)
      }
    }
    expect(missing).toEqual([])
  })

  it("every local link in the site points at a file in www/", () => {
    const missing: string[] = []
    for (const file of SITE) {
      for (const m of read(file).matchAll(/href="(\/[^"#]*)/g)) {
        const target = m[1] === '/' ? '/index.html' : m[1]!
        if (!existsSync(join(ROOT, 'www', target))) missing.push(`${file}: ${m[1]}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('every skill the site and the jsuite skill name exists in the repo or is a known global one', () => {
    const owned = new Set([
      ...readdirSync(join(APP, '.claude', 'skills')),
      ...readdirSync(join(ROOT, '.claude', 'skills')),
    ])
    // Not owned by this repo, installed globally (mattpocock/skills, built-ins).
    const global = new Set(['code-review', 'grilling'])
    const named = new Set<string>()
    for (const file of SITE) {
      for (const m of read(file).matchAll(/<span class="chip">([a-z][a-z0-9-]*)<\/span>/g)) named.add(m[1]!)
      for (const m of read(file).matchAll(/<div class="skill-card">\s*<h3>([a-z][a-z0-9-]*)<\/h3>/g)) named.add(m[1]!)
    }
    const skill = read('.claude/skills/jsuite/SKILL.md')
    const list = skill.match(/Skills \(all in `apps\/jticket\/\.claude\/skills`\):([\s\S]*?)\n\n/)?.[1] ?? ''
    for (const m of list.matchAll(/`([a-z][a-z0-9-]*)`/g)) named.add(m[1]!)
    for (const file of DOCS) {
      for (const m of read(file).matchAll(/skill `([a-z][a-z0-9-]*)`/g)) named.add(m[1]!)
    }
    expect(named.size).toBeGreaterThan(10)
    expect([...named].filter((name) => !owned.has(name) && !global.has(name))).toEqual([])
    // The jsuite skill's list is the whole of what jTicket owns.
    const listed = [...list.matchAll(/`([a-z][a-z0-9-]*)`/g)].map((m) => m[1]).sort()
    const jticketOwned = readdirSync(join(APP, '.claude', 'skills'))
      .filter((d) => existsSync(join(APP, '.claude', 'skills', d, 'SKILL.md')))
      .sort()
    expect(listed).toEqual(jticketOwned)
  })

  it('no doc or page sends a reader to a retired app (redirect hosts excepted)', () => {
    const retired = /https?:\/\/(jdiff|jgrilling|jcode|jmap)\.local|:4300[1-8]\b|\bjdiff (pr|branch)\b|\b(Open|open in) (jDiff|jChart|jExplain|jReview|jGrilling|jCode|jMap)\b/
    const offenders = [...DOCS, ...SITE].flatMap((file) =>
      read(file)
        .split('\n')
        .map((line, i) => ({ line, at: `${file}:${i + 1}` }))
        .filter(({ line }) => retired.test(line))
        .map(({ at, line }) => `${at}: ${line.trim()}`),
    )
    expect(offenders).toEqual([])
    // The redirect-only hosts may be named, but only as redirects.
    for (const file of SITE) {
      for (const m of read(file).matchAll(/href="https:\/\/(jexplain|jreview|jchart)\.local/g)) {
        throw new Error(`${file} links through the redirect-only host ${m[1]}.local`)
      }
    }
  })
})
