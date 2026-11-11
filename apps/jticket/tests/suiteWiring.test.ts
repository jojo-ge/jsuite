import { spawnSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

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

// The skill links are made and pruned by ONE implementation, link_skills in
// ./jsuite (TICK-977): `./jsuite setup`, `./jsuite skills` and j-setup all run
// it, so a change to the prune rule can't land in one installer and not the
// other. These run the real scripts against a throwaway CLAUDE_CONFIG_DIR.
describe('skill links have one implementation', () => {
  const tmp: string[] = []
  afterEach(() => {
    for (const dir of tmp.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  /** A config dir whose skills/ holds an old copy, a dangling link, a live foreign link and a foreign dir. */
  function seeded() {
    const config = mkdtempSync(join(tmpdir(), 'skill-links-'))
    tmp.push(config)
    const skills = join(config, 'skills')
    mkdirSync(join(skills, 'jimplement'), { recursive: true })
    writeFileSync(join(skills, 'jimplement', 'SKILL.md'), 'an old copy')
    symlinkSync(join(config, 'gone', 'retired-skill'), join(skills, 'retired-skill'))
    mkdirSync(join(config, 'elsewhere', 'foreign'), { recursive: true })
    symlinkSync(join(config, 'elsewhere', 'foreign'), join(skills, 'foreign-link'))
    mkdirSync(join(skills, 'foreign-dir'))
    return { config, skills }
  }

  function run(script: string, args: string[], config: string) {
    const res = spawnSync('bash', [join(ROOT, script), ...args], {
      env: { ...process.env, CLAUDE_CONFIG_DIR: config },
      encoding: 'utf8',
    })
    expect(res.status, res.stderr + res.stdout).toBe(0)
    return res.stdout
  }

  /** name -> link target ('dir' for a real directory), sorted by name. */
  function snapshot(skills: string) {
    return Object.fromEntries(
      readdirSync(skills)
        .sort()
        .map((name) => {
          const path = join(skills, name)
          return [name, lstatSync(path).isSymbolicLink() ? readlinkSync(path) : 'dir']
        }),
    )
  }

  it('`jsuite skills` links every manifest skill, replaces old copies and prunes only dangling links', () => {
    const { skills } = seeded()
    run('jsuite', ['skills'], join(skills, '..'))
    const after = snapshot(skills)
    for (const [dir, names] of manifest) {
      for (const name of names) expect(resolve(after[name]!), name).toBe(join(ROOT, dir, '.claude/skills', name))
    }
    expect(after['retired-skill']).toBeUndefined()
    expect(after['foreign-link']).toBe(join(skills, '..', 'elsewhere', 'foreign'))
    expect(after['foreign-dir']).toBe('dir')
  })

  it('j-setup --skills does exactly what `jsuite skills --only apps/jticket` does', () => {
    const viaSetup = seeded()
    const viaSuite = seeded()
    run('apps/jticket/j-setup', ['--skills'], viaSetup.config)
    run('jsuite', ['skills', '--only', 'apps/jticket'], viaSuite.config)
    const rebase = (snap: Record<string, string>, config: string) =>
      Object.fromEntries(Object.entries(snap).map(([k, v]) => [k, v.replace(config, '<config>')]))
    const a = rebase(snapshot(viaSetup.skills), viaSetup.config)
    expect(a).toEqual(rebase(snapshot(viaSuite.skills), viaSuite.config))
    expect(a['retired-skill']).toBeUndefined()
    expect(a.jsuite).toBeUndefined()
    for (const name of manifest.get('apps/jticket')!) expect(a[name], name).toBe(join(ROOT, 'apps/jticket/.claude/skills', name))
  })

  it('--dry-run changes nothing, from either entry point', () => {
    const { config, skills } = seeded()
    const before = snapshot(skills)
    expect(run('jsuite', ['skills', '--dry-run'], config)).toContain('pruned retired-skill')
    run('apps/jticket/j-setup', ['--skills', '--dry-run'], config)
    expect(snapshot(skills)).toEqual(before)
  })

  it('j-setup keeps no skill list or link/prune logic of its own', () => {
    const jsetup = read('apps/jticket/j-setup').replace(/^\s*#.*$/gm, '')
    expect(jsetup).not.toMatch(/JSKILLS|ln -s|readlink|rm -(r|f)/)
    expect(jsetup).toMatch(/"\$JSUITE" "\$\{skills_args\[@\]\}"/)
  })
})
