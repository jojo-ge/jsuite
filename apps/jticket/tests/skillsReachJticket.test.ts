import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

// The review engine runs inside jTicket (TICK-942): jReview's :43008 routes are
// gone, and a sandbox only rewrites jTicket's base URL (jt honours
// JTICKET_URL). A jTicket-owned skill that still reaches jReview directly 404s
// on the live suite and reads the LIVE suite from a sandbox (TICK-962).

const SKILLS_DIR = join(__dirname, '..', '.claude', 'skills')

function markdownFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return markdownFiles(path)
    return name.endsWith('.md') ? [path] : []
  })
}

const JREVIEW_DIRECT = [/:43008\b/, /jreview\.local/, /\bJREVIEW_URL\b/, /\$\{?JREVIEW\b/]

describe('jTicket-owned skills reach reviews through jTicket', () => {
  it('no skill calls jReview’s retired :43008 server', () => {
    const offenders = markdownFiles(SKILLS_DIR).flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .map((line, i) => ({ line, at: `${relative(SKILLS_DIR, file)}:${i + 1}` }))
        .filter(({ line }) => JREVIEW_DIRECT.some((re) => re.test(line)))
        .map(({ at, line }) => `${at}: ${line.trim()}`),
    )
    expect(offenders).toEqual([])
  })

  it('no skill names jReview as the app that dispatches it or brands its reports', () => {
    // TICK-951: no doc, skill or page names a retired app as a running product.
    const RUNNING = [/^description:.*\bjReview\b/, /kicker\W+jReview\b/, /\bDispatched by jReview\b/, /\bsession jReview dispatches\b/]
    const offenders = markdownFiles(SKILLS_DIR).flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .map((line, i) => ({ line, at: `${relative(SKILLS_DIR, file)}:${i + 1}` }))
        .filter(({ line }) => RUNNING.some((re) => re.test(line)))
        .map(({ at, line }) => `${at}: ${line.trim()}`),
    )
    expect(offenders).toEqual([])
  })

  it('jslice-report reads a review and its reports with jt', () => {
    const skill = readFileSync(join(SKILLS_DIR, 'jslice-report', 'SKILL.md'), 'utf8')
    expect(skill).toMatch(/jt get \/api\/reviews\/<key>/)
    expect(skill).toMatch(/jt get \/api\/documents\/<docKey>/)
    expect(skill).not.toMatch(/curl\s/)
  })

  // TICK-943: the review skills moved from apps/jreview into jTicket's. The
  // reviewer prompt names the report skill by path (it is typed-only), so a
  // stale path leaves every reviewer unable to publish.
  it('the reviewer prompt names a report skill that exists', () => {
    const herdr = readFileSync(join(__dirname, '..', 'server', 'utils', 'reviewHerdr.ts'), 'utf8')
    const rel = /REPORT_SKILL = join\(suiteRoot\(\), '([^']+)'\)/.exec(herdr)?.[1]
    expect(rel).toBe('apps/jticket/.claude/skills/jreview-report/SKILL.md')
    expect(existsSync(join(__dirname, '..', '..', '..', rel!))).toBe(true)
  })

  it('every review skill lives in jTicket', () => {
    for (const name of ['jreview-report', 'jreview-triage', 'jreview-consensus', 'jarch-review']) {
      expect(existsSync(join(SKILLS_DIR, name, 'SKILL.md')), name).toBe(true)
    }
  })

  it('jdiff-tour hands its tour to jTicket with jt, never to jDiff', () => {
    const skill = readFileSync(join(SKILLS_DIR, 'jdiff-tour', 'SKILL.md'), 'utf8')
    expect(skill).toMatch(/jt post \/api\/projects\/<project>\/diff\/tour\/artifact/)
    expect(skill).toMatch(/jt post \/api\/projects\/<project>\/diff\/tour\/complete/)
    expect(skill).not.toMatch(/:43002\b|jdiff\.local|JDIFF_URL|curl\s/)
  })
})
