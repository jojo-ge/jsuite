import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { appDataDir } from '@jsuite/data'
import type { FilePayload } from './buildDiff'

export interface CachedDiff {
  headOid: string
  createdAt: string
  files: FilePayload[]
}

// Parsed + highlighted diff per resolved repo path + PR number, valid while
// the PR's head commit is unchanged; a push overwrites on the next open.
const DIR = join(appDataDir('jdiff'), 'diff-cache')

function fileFor(repo: string, number: string): string {
  const hash = createHash('sha1').update(`${repo}\n${number}`).digest('hex')
  return join(DIR, `${hash}.json`)
}

export function loadDiff(repo: string, number: string, headOid: string): CachedDiff | null {
  try {
    const cached: CachedDiff = JSON.parse(readFileSync(fileFor(repo, number), 'utf8'))
    return cached.headOid === headOid ? cached : null
  } catch {
    return null
  }
}

export function saveDiff(repo: string, number: string, entry: CachedDiff): void {
  mkdirSync(DIR, { recursive: true })
  writeFileSync(fileFor(repo, number), JSON.stringify(entry))
}
