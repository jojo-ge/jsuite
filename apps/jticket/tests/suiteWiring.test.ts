import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// jTicket is the suite's only app (TICK-950). The launcher's tables, the
// installer j-setup, the Caddyfile and the OrbStack label each restate part of
// that wiring; these checks keep them in step so `./jsuite setup` installs
// every skill jTicket owns and the edge answers exactly the names it claims.

const ROOT = join(__dirname, '..', '..', '..')
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8')

/** The entries of a bash array `NAME=( … )`, quotes stripped. */
function bashArray(source: string, name: string): string[] {
  const body = source.match(new RegExp(`^${name}=\\(([\\s\\S]*?)\\)`, 'm'))?.[1]
  if (body === undefined) throw new Error(`${name} not found`)
  return body
    .split('\n')
    .map((line) => line.replace(/#.*$/, '').trim())
    .filter(Boolean)
    .flatMap((line) => (line.startsWith('"') ? [line.slice(1, -1)] : line.split(/\s+/)))
}

const launcher = read('jsuite')
const manifest = new Map(
  bashArray(launcher, 'SKILLS_MANIFEST').map((row) => {
    const [dir, skills] = row.split('|')
    return [dir!, skills!.split(/\s+/)]
  }),
)

describe('the suite is wired as one app', () => {
  it('only jTicket remains under apps/', () => {
    expect(readdirSync(join(ROOT, 'apps')).filter((d) => !d.startsWith('.'))).toEqual(['jticket'])
    expect(bashArray(launcher, 'APPS').map((row) => row.split('|')[0])).toEqual(['jticket'])
  })

  it('the lockfile has no other app importer', () => {
    const importers = [...read('pnpm-lock.yaml').matchAll(/^ {2}(apps\/[^:]+):$/gm)].map((m) => m[1])
    expect(importers).toEqual(['apps/jticket'])
  })

  it('setup installs only the suite skill and jTicket’s skills, and each exists', () => {
    expect([...manifest.keys()]).toEqual(['.', 'apps/jticket'])
    for (const [dir, skills] of manifest) {
      for (const skill of skills) expect(existsSync(join(ROOT, dir, '.claude/skills', skill, 'SKILL.md')), skill).toBe(true)
    }
  })

  it('j-setup installs the same jTicket skills as the manifest', () => {
    const jsetup = bashArray(read('apps/jticket/j-setup'), 'JSKILLS')
    expect([...jsetup].sort()).toEqual([...manifest.get('apps/jticket')!].sort())
  })

  it('setup and j-setup prune dangling skill links', () => {
    expect(launcher).toMatch(/-L "\$link" && ! -e "\$link"/)
    expect(read('apps/jticket/j-setup')).toMatch(/-L "\$link" \] && \[ ! -e "\$link"/)
  })

  it('the edge, the OrbStack label and DOMAINS name the same hosts', () => {
    const domains = bashArray(launcher, 'DOMAINS').sort()
    const label = read('docker-compose.yml').match(/dev\.orbstack\.domains:\s*(\S+)/)![1]!.split(',').sort()
    const caddy = [...read('Caddyfile').matchAll(/^http:\/\/([\w.-]+):80 \{/gm)].map((m) => m[1]).sort()
    expect(label).toEqual(domains)
    expect(caddy).toEqual(domains)
    expect(domains).toEqual(['jchart.local', 'jexplain.local', 'jreview.local', 'jsuite.local', 'jticket.local'])
  })

  it('the retired names only redirect into jTicket', () => {
    const caddy = read('Caddyfile')
    const site = (host: string) => caddy.match(new RegExp(`^http://${host.replace('.', '\\.')}:80 \\{([\\s\\S]*?)^\\}`, 'm'))![1]!
    for (const host of ['jexplain.local', 'jreview.local', 'jchart.local']) {
      expect(site(host)).not.toMatch(/reverse_proxy|import app/)
    }
    expect(site('jexplain.local')).toContain('redir /e/* https://jticket.local{uri}')
    expect(site('jreview.local')).toMatch(/handle_path \/r\/\* \{\s*redir https:\/\/jticket\.local\/reviews\{uri\}/)
    expect(site('jchart.local')).toMatch(/handle_path \/c\/\* \{\s*redir https:\/\/jticket\.local\/charts\{uri\}/)
  })

  it('the shared packages describe one app, not the retired processes', () => {
    const charting = read('packages/charting/nuxt.config.ts')
    expect(charting).not.toMatch(/layered apps|jexplain\/jchart/)
    const herdr = read('packages/herdr/index.mjs')
    expect(herdr).not.toMatch(/jSuite apps|several processes|jReview's watcher|\bjDiff\b/)
  })

  it('no root script starts a retired app', () => {
    const scripts = Object.keys(JSON.parse(read('package.json')).scripts)
    expect(scripts.filter((s) => s.startsWith('dev:'))).toEqual([])
  })
})
