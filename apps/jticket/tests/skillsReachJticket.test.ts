import { readdirSync, readFileSync, statSync } from 'node:fs'
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

  it('jslice-report reads a review and its reports with jt', () => {
    const skill = readFileSync(join(SKILLS_DIR, 'jslice-report', 'SKILL.md'), 'utf8')
    expect(skill).toMatch(/jt get \/api\/reviews\/<key>/)
    expect(skill).toMatch(/jt get \/api\/documents\/<docKey>/)
    expect(skill).not.toMatch(/curl\s/)
  })
})
