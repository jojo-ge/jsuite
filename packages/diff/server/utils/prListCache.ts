import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { appDataDir } from '@jsuite/data'

export interface CachedPrList {
  createdAt: string
  prs: any[]
}

// Raw `gh pr list` output per resolved repo path, served while younger than
// FRESH_MS; the refresh button bypasses it. Rating scores are merged in at
// request time, so a fresh rating shows even on a cached list.
const DIR = join(appDataDir('jdiff'), 'pr-list-cache')
const FRESH_MS = 60_000

function fileFor(repo: string): string {
  const hash = createHash('sha1').update(repo).digest('hex')
  return join(DIR, `${hash}.json`)
}

export function loadPrList(repo: string): any[] | null {
  try {
    const cached: CachedPrList = JSON.parse(readFileSync(fileFor(repo), 'utf8'))
    const age = Date.now() - new Date(cached.createdAt).getTime()
    return age >= 0 && age < FRESH_MS ? cached.prs : null
  } catch {
    return null
  }
}

export function savePrList(repo: string, prs: any[]): void {
  mkdirSync(DIR, { recursive: true })
  writeFileSync(fileFor(repo), JSON.stringify({ createdAt: new Date().toISOString(), prs }))
}
